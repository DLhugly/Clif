//! Local Models — hardware-aware discovery, download, and management of
//! on-device coding models. (PRD: docs/PRD-local-models-tab.md, Phase 1.)
//!
//! Filenames + sizes are resolved from the Hugging Face API (see `hf.rs`), never
//! guessed. Inference itself goes through `engine::LocalEngine` (stubbed in v1).

mod catalog;
mod download;
mod engine;
mod hardware;
mod hf;
mod store;

use catalog::CatalogEntry;
use hardware::HardwareInfo;
use hf::HfModelSummary;
use serde::Serialize;
use tauri::AppHandle;

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

/// The curated catalog, annotated with hardware fit + download/active state.
/// Sorted best-fit first so good recommendations float to the top.
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
            CatalogEntry {
                model,
                fit: fit.to_string(),
                fit_label: fit_label.to_string(),
                downloaded,
                active: is_active,
            }
        })
        .collect();

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
