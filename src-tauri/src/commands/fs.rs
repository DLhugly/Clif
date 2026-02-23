use crate::services::file_watcher::WatcherState;
use crate::state::AppState;
use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub fn read_dir(path: String, _state: tauri::State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries: Vec<FileEntry> = Vec::new();

    let read_result = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_result {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs starting with '.'
        if file_name.starts_with('.') {
            continue;
        }

        // Skip node_modules and target directories
        if file_name == "node_modules" || file_name == "target" || file_name == "dist" {
            continue;
        }

        let file_path = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let extension = if is_dir {
            None
        } else {
            entry
                .path()
                .extension()
                .map(|ext| ext.to_string_lossy().to_string())
        };

        entries.push(FileEntry {
            name: file_name,
            path: file_path,
            is_dir,
            extension,
            children: None,
        });
    }

    // Sort: directories first, then alphabetical by name (case-insensitive)
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
    }

    fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    if file_path.exists() {
        return Err(format!("File already exists: {}", path));
    }

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
    }

    fs::File::create(file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let dir_path = Path::new(&path);

    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", path));
    }

    fs::create_dir_all(dir_path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
pub fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);

    if !old.exists() {
        return Err(format!("Source path does not exist: {}", old_path));
    }

    if new.exists() {
        return Err(format!("Destination path already exists: {}", new_path));
    }

    fs::rename(old, new).map_err(|e| format!("Failed to rename: {}", e))
}

#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    let entry_path = Path::new(&path);

    if !entry_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if entry_path.is_dir() {
        fs::remove_dir_all(entry_path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(entry_path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub fn watch_dir(
    path: String,
    app: tauri::AppHandle,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    crate::services::file_watcher::start_watching(&app, &watcher_state, &path)
}
