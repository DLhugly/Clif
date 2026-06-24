//! On-disk storage for downloaded local models.
//!
//! Mirrors the OS-cache convention used by the indexer
//! (`commands/indexer/store.rs`): models live under the platform cache dir so
//! they survive across workspaces and don't pollute the user's project.
//!
//!   macOS:   ~/Library/Caches/com.clif.pad/models/<id>/
//!   Linux:   ~/.cache/clif-pad/models/<id>/   ($XDG_CACHE_HOME honored)
//!   Windows: %LOCALAPPDATA%/clif-pad/models/<id>/

use std::path::PathBuf;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Root cache directory for ClifPad (platform-appropriate).
fn cache_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = home_dir() {
            return home.join("Library").join("Caches").join("com.clif.pad");
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local).join("clif-pad");
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_CACHE_HOME") {
            return PathBuf::from(xdg).join("clif-pad");
        }
        if let Some(home) = home_dir() {
            return home.join(".cache").join("clif-pad");
        }
    }
    // Last-resort fallback so we never panic.
    PathBuf::from(".clif").join("cache")
}

/// Directory that holds all downloaded models.
pub fn models_dir() -> PathBuf {
    cache_root().join("models")
}

/// Directory for a single model id.
pub fn model_dir(id: &str) -> PathBuf {
    models_dir().join(sanitize(id))
}

/// Full path to a model's weight file on disk.
pub fn model_file_path(id: &str, file: &str) -> PathBuf {
    model_dir(id).join(sanitize(file))
}

/// Path to the small JSON marker recording which model is active.
fn active_marker() -> PathBuf {
    models_dir().join("active.json")
}

pub fn read_active() -> Option<String> {
    let raw = std::fs::read_to_string(active_marker()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("id").and_then(|i| i.as_str()).map(|s| s.to_string())
}

pub fn write_active(id: Option<&str>) -> Result<(), String> {
    std::fs::create_dir_all(models_dir()).map_err(|e| e.to_string())?;
    match id {
        Some(id) => {
            let body = serde_json::json!({ "id": id });
            std::fs::write(active_marker(), body.to_string()).map_err(|e| e.to_string())
        }
        None => {
            let _ = std::fs::remove_file(active_marker());
            Ok(())
        }
    }
}

/// Keep ids/filenames from escaping the models dir.
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            '/' => '_',
            _ => '_',
        })
        .collect()
}
