//! Streaming model download from Hugging Face.
//!
//! The filename is RESOLVED from the HF API (never guessed): we look up the GGUF
//! matching the catalog quant, then stream `resolve/main/<filename>` to disk with
//! the same bearer auth (so gated repos work). Progress streams to the frontend
//! as `local_model_download_progress` events.

use super::catalog::CatalogModel;
use super::hf;
use super::store;
use serde::Serialize;
use std::io::Write;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub filename: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub done: bool,
    pub error: Option<String>,
}

fn emit(app: &AppHandle, p: DownloadProgress) {
    let _ = app.emit("local_model_download_progress", p);
}

/// Resolve + download a catalog model. Runs to completion; the caller spawns it.
pub async fn run(app: AppHandle, model: CatalogModel, token: Option<String>) {
    let id = model.id.clone();
    if let Err(e) = run_inner(&app, &model, &token).await {
        emit(
            &app,
            DownloadProgress {
                id,
                filename: None,
                downloaded_bytes: 0,
                total_bytes: 0,
                percent: 0.0,
                done: true,
                error: Some(e),
            },
        );
    }
}

async fn run_inner(
    app: &AppHandle,
    model: &CatalogModel,
    token: &Option<String>,
) -> Result<(), String> {
    use futures::StreamExt;

    // 1) Resolve the real GGUF filename + size from the HF API.
    let file = hf::resolve_gguf(&model.hf_repo, &model.quant, token).await?;
    let url = hf::resolve_url(&model.hf_repo, &file.filename);

    let dir = store::model_dir(&model.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let final_path = store::download_target(&model.id, &file.filename);
    let part_path = final_path.with_extension("gguf.part");

    // 2) Stream it down (bearer auth for gated repos).
    let client = reqwest::Client::new();
    let mut req = client.get(&url).header("User-Agent", "ClifPad-LocalModels/1.0");
    if let Some(t) = token.clone().or_else(|| std::env::var("HF_TOKEN").ok()).filter(|t| !t.is_empty()) {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await.map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {} for {}", resp.status(), url));
    }

    // Prefer the API's LFS size; fall back to content-length.
    let total_bytes = if file.size_bytes > 0 {
        file.size_bytes
    } else {
        resp.content_length().unwrap_or(0)
    };

    let mut downloaded: u64 = 0;
    let mut last_emit_pct = -1.0_f64;
    let mut out = std::fs::File::create(&part_path).map_err(|e| format!("create file: {e}"))?;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        out.write_all(&chunk).map_err(|e| format!("write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };
        if percent - last_emit_pct >= 1.0 || total_bytes == 0 {
            last_emit_pct = percent;
            emit(
                app,
                DownloadProgress {
                    id: model.id.clone(),
                    filename: Some(file.filename.clone()),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                    done: false,
                    error: None,
                },
            );
        }
    }

    out.flush().map_err(|e| format!("flush: {e}"))?;
    drop(out);
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("finalize: {e}"))?;

    emit(
        app,
        DownloadProgress {
            id: model.id.clone(),
            filename: Some(file.filename.clone()),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: 100.0,
            done: true,
            error: None,
        },
    );
    Ok(())
}
