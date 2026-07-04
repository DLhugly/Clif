//! Discover GGUF models the user already has on disk from other tools, so they
//! show up in the Local Models screen without re-downloading.
//!
//! Scans the well-known stores:
//!   - LM Studio:    ~/.lmstudio/models, ~/.cache/lm-studio/models
//!   - HF hub cache: ~/.cache/huggingface/hub
//!   - Ollama:       ~/.ollama/models (via manifests -> model blob)
//!   - Clif's own:   our OS cache models dir
//!
//! Everything is best-effort: missing dirs / parse errors are skipped silently.

use super::hf;
use super::store;
use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct DiscoveredModel {
    /// "lmstudio" | "huggingface" | "ollama" | "clif"
    pub source: String,
    pub name: String,
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub quant: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Scan every known location and return de-duplicated discoveries.
pub fn scan() -> Vec<DiscoveredModel> {
    let mut out: Vec<DiscoveredModel> = Vec::new();

    if let Some(h) = home() {
        // Direct .gguf stores.
        scan_gguf_dir(&h.join(".lmstudio").join("models"), "lmstudio", &mut out);
        scan_gguf_dir(&h.join(".cache").join("lm-studio").join("models"), "lmstudio", &mut out);
        scan_gguf_dir(&h.join(".cache").join("huggingface").join("hub"), "huggingface", &mut out);
        // Ollama stores blobs by digest — resolve via manifests.
        scan_ollama(&h.join(".ollama").join("models"), &mut out);
    }
    // Clif's own downloads.
    scan_gguf_dir(&store::models_dir(), "clif", &mut out);

    // De-dup by absolute path.
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    // Biggest first (usually the most capable).
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    out
}

fn scan_gguf_dir(dir: &Path, source: &str, out: &mut Vec<DiscoveredModel>) {
    if !dir.is_dir() {
        return;
    }
    for entry in WalkDir::new(dir)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let lower = name.to_lowercase();
        if !lower.ends_with(".gguf") || lower.ends_with(".part") {
            continue;
        }
        // Skip sharded parts beyond the first to avoid double-counting.
        if lower.contains("-of-") && !lower.contains("00001-of-") {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(DiscoveredModel {
            source: source.to_string(),
            name: pretty_name(path, name),
            filename: name.to_string(),
            path: path.to_string_lossy().to_string(),
            size_bytes: size,
            quant: hf::parse_quant(name),
        });
    }
}

/// Use the parent dir name when it's more descriptive than the file itself
/// (HF/LM Studio nest as <publisher>/<repo>/<file>.gguf).
fn pretty_name(path: &Path, filename: &str) -> String {
    if let Some(parent) = path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
        let p = parent.to_lowercase();
        if p != "gguf" && !p.starts_with("snapshots") && parent.len() > 2 {
            return parent.to_string();
        }
    }
    filename.trim_end_matches(".gguf").to_string()
}

// --- Ollama (blobs addressed by digest; names live in manifests) -----------

fn scan_ollama(root: &Path, out: &mut Vec<DiscoveredModel>) {
    let manifests = root.join("manifests");
    let blobs = root.join("blobs");
    if !manifests.is_dir() || !blobs.is_dir() {
        return;
    }
    for entry in WalkDir::new(&manifests)
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let raw = match std::fs::read_to_string(entry.path()) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let json: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let layers = match json.get("layers").and_then(|l| l.as_array()) {
            Some(l) => l,
            None => continue,
        };
        // The GGUF weights are the "*.model" layer.
        let model_layer = layers.iter().find(|l| {
            l.get("mediaType")
                .and_then(|m| m.as_str())
                .map(|m| m.contains(".model"))
                .unwrap_or(false)
        });
        if let Some(layer) = model_layer {
            let size = layer.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let digest = layer
                .get("digest")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .replace(':', "-");
            let blob_path = blobs.join(&digest);
            if digest.is_empty() {
                continue;
            }
            // Name from the manifest path: .../library/<model>/<tag>
            let name = ollama_name(entry.path());
            out.push(DiscoveredModel {
                source: "ollama".to_string(),
                name,
                filename: format!("{digest}.gguf"),
                path: blob_path.to_string_lossy().to_string(),
                size_bytes: size,
                quant: "GGUF".to_string(),
            });
        }
    }
}

fn ollama_name(manifest: &Path) -> String {
    let tag = manifest.file_name().and_then(|n| n.to_str()).unwrap_or("latest");
    let model = manifest
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("model");
    format!("{model}:{tag}")
}
