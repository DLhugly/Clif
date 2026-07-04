//! Local Models — hardware-aware discovery, download, and management of
//! on-device coding models. (PRD: docs/PRD-local-models-tab.md, Phase 1.)
//!
//! Filenames + sizes are resolved from the Hugging Face API (see `hf.rs`), never
//! guessed. Inference runs in-process via `engine::Engine` (llama.cpp / GGUF).

mod catalog;
mod download;
mod engine;
mod hardware;
mod hf;
mod scan;
mod store;

use catalog::CatalogEntry;
use hardware::HardwareInfo;
use hf::HfModelSummary;
use serde::Serialize;
use std::sync::OnceLock;
use tauri::AppHandle;

/// Process-wide inference engine (llama.cpp backend inits once, lazily).
static ENGINE: OnceLock<Result<engine::Engine, String>> = OnceLock::new();

fn engine() -> Result<&'static engine::Engine, String> {
    ENGINE
        .get_or_init(engine::Engine::new)
        .as_ref()
        .map_err(|e| e.clone())
}

/// One downloadable quant of a model, with real HF size + hardware fit.
#[derive(Serialize)]
pub struct VariantFit {
    pub filename: String,
    pub quant: String,
    pub size_bytes: u64,
    pub fit: String,
    pub fit_label: String,
    /// True for the quant matching the catalog's recommended `quant`.
    pub recommended: bool,
}

/// Full HF-verified detail for one catalog model: popularity + all quant options.
#[derive(Serialize)]
pub struct ModelVariants {
    pub id: String,
    pub repo: String,
    pub downloads: u64,
    pub likes: u64,
    pub gated: bool,
    pub variants: Vec<VariantFit>,
}

#[derive(Serialize)]
pub struct DownloadedModel {
    pub id: String,
    pub name: String,
    pub file: String,
    pub size_bytes: u64,
    pub path: String,
    pub active: bool,
}

/// Resolved HF file for a catalog model (exact filename + size — no guessing).
#[derive(Serialize)]
pub struct ResolvedModel {
    pub id: String,
    pub repo: String,
    pub filename: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn local_detect_hardware() -> Result<HardwareInfo, String> {
    Ok(hardware::detect())
}

/// The curated catalog, annotated with hardware fit + speed + download/active
/// state, and exactly one "recommended" pick for this machine. Sorted best-fit
/// first so good recommendations float to the top.
#[tauri::command]
pub fn local_models_catalog() -> Result<Vec<CatalogEntry>, String> {
    let hw = hardware::detect();
    let active = store::read_active();

    let mut entries: Vec<CatalogEntry> = catalog::all()
        .into_iter()
        .map(|model| {
            let downloaded = store::is_downloaded(&model.id);
            let is_active = active.as_deref() == Some(model.id.as_str());
            let (fit, fit_label) = catalog::fit_for(model.size_gb, hw.total_ram_gb);
            let (speed, speed_label) = catalog::speed_for(model.active_b);
            CatalogEntry {
                model,
                fit: fit.to_string(),
                fit_label: fit_label.to_string(),
                speed: speed.to_string(),
                speed_label: speed_label.to_string(),
                downloaded,
                active: is_active,
                recommended: false,
            }
        })
        .collect();

    // Recommend the strongest model that fits well (comfortable/good). Fall back
    // to the best-fitting one if nothing fits comfortably.
    let best = entries
        .iter()
        .filter(|e| e.fit == "comfortable" || e.fit == "good")
        .max_by_key(|e| e.model.capability)
        .or_else(|| entries.iter().min_by_key(|e| fit_rank(&e.fit)))
        .map(|e| e.model.id.clone());
    if let Some(best_id) = best {
        for e in entries.iter_mut() {
            e.recommended = e.model.id == best_id;
        }
    }

    entries.sort_by_key(|e| fit_rank(&e.fit));
    Ok(entries)
}

fn fit_rank(fit: &str) -> u8 {
    match fit {
        "comfortable" => 0,
        "good" => 1,
        "slow" => 2,
        _ => 3,
    }
}

#[tauri::command]
pub fn local_models_list() -> Result<Vec<DownloadedModel>, String> {
    let active = store::read_active();
    let mut out = Vec::new();

    for model in catalog::all() {
        if let Some(path) = store::downloaded_file(&model.id) {
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let file = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(DownloadedModel {
                id: model.id.clone(),
                name: model.name.clone(),
                file,
                size_bytes,
                path: path.to_string_lossy().to_string(),
                active: active.as_deref() == Some(model.id.as_str()),
            });
        }
    }
    Ok(out)
}

/// Resolve a catalog model's exact GGUF filename + size from the HF API,
/// without downloading. Used by the UI to verify availability + show real size.
#[tauri::command]
pub async fn local_model_resolve(id: String, token: Option<String>) -> Result<ResolvedModel, String> {
    let model = catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    let file = hf::resolve_gguf(&model.hf_repo, &model.quant, &token).await?;
    Ok(ResolvedModel {
        id: model.id,
        repo: model.hf_repo,
        filename: file.filename,
        size_bytes: file.size_bytes,
    })
}

/// HF-verified detail for one catalog model: popularity + every quant option
/// with real sizes and per-quant hardware fit. Powers the full-screen detail
/// view. No token required for public repos.
#[tauri::command]
pub async fn local_model_variants(id: String, token: Option<String>) -> Result<ModelVariants, String> {
    let model = catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    let hw = hardware::detect();

    // Popularity is best-effort — if it fails, still return quants.
    let info = hf::model_info(&model.hf_repo, &token)
        .await
        .unwrap_or(hf::HfModelInfo { downloads: 0, likes: 0, gated: false });

    let want_quant = model.quant.to_lowercase();
    let variants = hf::list_variants(&model.hf_repo, &token)
        .await?
        .into_iter()
        .map(|v| {
            let size_gb = v.size_bytes as f64 / 1_000_000_000.0;
            let (fit, fit_label) = catalog::fit_for(size_gb, hw.total_ram_gb);
            let recommended = v.quant.to_lowercase() == want_quant;
            VariantFit {
                filename: v.filename,
                quant: v.quant,
                size_bytes: v.size_bytes,
                fit: fit.to_string(),
                fit_label: fit_label.to_string(),
                recommended,
            }
        })
        .collect();

    Ok(ModelVariants {
        id: model.id,
        repo: model.hf_repo,
        downloads: info.downloads,
        likes: info.likes,
        gated: info.gated,
        variants,
    })
}

/// Search GGUF models on the Hugging Face Hub (for the model browser).
#[tauri::command]
pub async fn local_models_search(
    query: String,
    token: Option<String>,
) -> Result<Vec<HfModelSummary>, String> {
    hf::search_models(&query, &token).await
}

/// Kick off a download. Returns immediately; progress arrives via the
/// `local_model_download_progress` event stream.
#[tauri::command]
pub async fn local_model_download(
    app: AppHandle,
    id: String,
    token: Option<String>,
) -> Result<(), String> {
    let model = catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    tokio::spawn(async move {
        download::run(app, model, token).await;
    });
    Ok(())
}

#[tauri::command]
pub fn local_model_delete(id: String) -> Result<(), String> {
    if catalog::find(&id).is_none() {
        return Err(format!("unknown model: {id}"));
    }
    let dir = store::model_dir(&id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    if store::read_active().as_deref() == Some(id.as_str()) {
        store::write_active(None)?;
    }
    Ok(())
}

/// Mark a downloaded model as the active local model.
#[tauri::command]
pub fn local_model_set_active(id: String) -> Result<(), String> {
    catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    if !store::is_downloaded(&id) {
        return Err(format!("model '{id}' is not downloaded yet"));
    }
    store::write_active(Some(&id))
}

#[tauri::command]
pub fn local_model_active() -> Result<Option<String>, String> {
    Ok(store::read_active())
}

/// Discover GGUF models already on disk from Ollama / LM Studio / HF cache / Clif.
#[tauri::command]
pub fn local_scan_existing() -> Result<Vec<scan::DiscoveredModel>, String> {
    Ok(scan::scan())
}

/// Status of the embedded engine: backend + which model is resident.
#[tauri::command]
pub fn local_engine_status() -> Result<serde_json::Value, String> {
    let loaded = engine().ok().and_then(|e| e.loaded_id());
    let backend = if cfg!(target_os = "macos") {
        "llama.cpp (Metal)"
    } else {
        "llama.cpp (CPU)"
    };
    Ok(serde_json::json!({
        "backend": backend,
        "loaded": loaded,
        "active": store::read_active(),
    }))
}

/// Run the active local model in-process and return a completion. Loads the
/// model on first use. Proof that inference runs inside Clif — the streaming +
/// tool-call agent path wires in next.
#[tauri::command]
pub async fn local_engine_generate(
    prompt: String,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    // Generation is GPU/CPU-bound and blocking — keep it off the async runtime.
    tokio::task::spawn_blocking(move || {
        let eng = engine()?;
        let active = store::read_active().ok_or("no active local model set")?;

        if eng.loaded_id().as_deref() != Some(active.as_str()) {
            let path = store::downloaded_file(&active)
                .ok_or_else(|| format!("active model '{active}' is not downloaded"))?;
            let n_ctx = catalog::find(&active)
                .map(|m| m.context)
                .unwrap_or(4096)
                .min(8192);
            eng.load(&active, &path, n_ctx)?;
        }
        eng.generate(&prompt, max_tokens.unwrap_or(256))
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}
