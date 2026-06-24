//! Streaming model download from Hugging Face via the existing `reqwest` client.
//!
//! Uses the public `resolve/main` URL pattern so we don't need the `hf-hub` crate.
//! Progress is streamed to the frontend as `local_model_download_progress` events.

use super::catalog::CatalogModel;
use super::store;
use serde::Serialize;
use std::io::Write;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub done: bool,
    pub error: Option<String>,
}

fn emit(app: &AppHandle, p: DownloadProgress) {
    let _ = app.emit("local_model_download_progress", p);
}

fn hf_url(repo: &str, file: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo.trim_matches('/'),
        file
    )
}

/// Download a catalog model to disk, emitting progress. Runs to completion;
/// the caller spawns it so the command returns immediately.
pub async fn run(app: AppHandle, model: CatalogModel) {
    let id = model.id.clone();
    if let Err(e) = run_inner(&app, &model).await {
        emit(
            &app,
            DownloadProgress {
                id,
                downloaded_bytes: 0,
                total_bytes: 0,
                percent: 0.0,
                done: true,
                error: Some(e),
            },
        );
    }
}

async fn run_inner(app: &AppHandle, model: &CatalogModel) -> Result<(), String> {
    use futures::StreamExt;

    let dir = store::model_dir(&model.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;

    let final_path = store::model_file_path(&model.id, &model.file);
    let part_path = final_path.with_extension("part");

    let url = hf_url(&model.hf_repo, &model.file);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "download failed: HTTP {} for {}",
            resp.status(),
            url
        ));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_emit_pct = -1.0_f64;

    let mut file = std::fs::File::create(&part_path).map_err(|e| format!("create file: {e}"))?;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };
        // Throttle: only emit on ~1% movement to avoid event spam.
        if percent - last_emit_pct >= 1.0 || total_bytes == 0 {
            last_emit_pct = percent;
            emit(
                app,
                DownloadProgress {
                    id: model.id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                    done: false,
                    error: None,
                },
            );
        }
    }

    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("finalize: {e}"))?;

    emit(
        app,
        DownloadProgress {
            id: model.id.clone(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: 100.0,
            done: true,
            error: None,
        },
    );
    Ok(())
}
