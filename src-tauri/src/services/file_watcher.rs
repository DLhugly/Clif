use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String, // "create", "modify", "remove"
}

pub struct WatcherState {
    watcher: Mutex<Option<WatcherHandle>>,
}

struct WatcherHandle {
    _watcher: RecommendedWatcher,
}

impl WatcherState {
    pub fn new() -> Self {
        WatcherState {
            watcher: Mutex::new(None),
        }
    }
}

pub fn start_watching(
    app: &AppHandle,
    state: &WatcherState,
    path: &str,
) -> Result<(), String> {
    // Stop any existing watcher
    stop_watching(state);

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&PathBuf::from(path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    let app_clone = app.clone();
    let watch_path = path.to_string();

    // Spawn thread to process file system events
    std::thread::spawn(move || {
        while let Ok(result) = rx.recv() {
            if let Ok(event) = result {
                let kind_str = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "remove",
                    _ => continue,
                };

                for path in &event.paths {
                    let path_str = path.to_string_lossy().to_string();

                    // Skip hidden files/dirs, node_modules, target, .git
                    if should_ignore(&path_str) {
                        continue;
                    }

                    // Only emit for actual files, not directories
                    if path.is_file() || kind_str == "remove" {
                        let _ = app_clone.emit(
                            "file-changed",
                            FileChangeEvent {
                                path: path_str,
                                kind: kind_str.to_string(),
                            },
                        );
                    }
                }
            }
        }
    });

    let mut guard = state.watcher.lock().map_err(|e| format!("Lock error: {}", e))?;
    *guard = Some(WatcherHandle { _watcher: watcher });

    log::info!("File watcher started for: {}", watch_path);
    Ok(())
}

pub fn stop_watching(state: &WatcherState) {
    if let Ok(mut guard) = state.watcher.lock() {
        *guard = None;
    }
}

fn should_ignore(path: &str) -> bool {
    let ignore_patterns = [
        "/node_modules/",
        "/.git/",
        "/target/",
        "/.DS_Store",
        "/.claude/",
        "/dist/",
        "/.next/",
    ];
    ignore_patterns.iter().any(|p| path.contains(p))
}
