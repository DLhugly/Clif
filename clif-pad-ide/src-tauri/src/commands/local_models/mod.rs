//! Local Models — hardware-aware discovery, download, and management of
//! on-device coding models. (PRD: docs/PRD-local-models-tab.md, Phase 1.)
//!
//! v1 surface:
//!   - detect hardware                (`local_detect_hardware`)
//!   - catalog with per-model fit     (`local_models_catalog`)
//!   - list downloaded                (`local_models_list`)
//!   - download with progress events  (`local_model_download`)
//!   - delete / set-active / active   (`local_model_delete` / `_set_active` / `_active`)
//!
//! Inference itself goes through `engine::LocalEngine` (stubbed in v1).

mod catalog;
mod download;
mod engine;
mod hardware;
mod store;

use catalog::CatalogEntry;
use hardware::HardwareInfo;
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
            let downloaded = store::model_file_path(&model.id, &model.file).exists();
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
        let path = store::model_file_path(&model.id, &model.file);
        if let Ok(meta) = std::fs::metadata(&path) {
            out.push(DownloadedModel {
                id: model.id.clone(),
                name: model.name.clone(),
                file: model.file.clone(),
                size_bytes: meta.len(),
                path: path.to_string_lossy().to_string(),
                active: active.as_deref() == Some(model.id.as_str()),
            });
        }
    }
    Ok(out)
}

/// Kick off a download. Returns immediately; progress arrives via the
/// `local_model_download_progress` event stream.
#[tauri::command]
pub async fn local_model_download(app: AppHandle, id: String) -> Result<(), String> {
    let model = catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    tokio::spawn(async move {
        download::run(app, model).await;
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
    let model = catalog::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    if !store::model_file_path(&model.id, &model.file).exists() {
        return Err(format!("model '{id}' is not downloaded yet"));
    }
    store::write_active(Some(&id))
}

#[tauri::command]
pub fn local_model_active() -> Result<Option<String>, String> {
    Ok(store::read_active())
}
