use std::fs;
use std::path::PathBuf;

/// Get the path to the settings file
fn get_settings_path() -> Result<PathBuf, String> {
    let home = get_home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_dir = home.join(".agentbase");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir.join("settings.json"))
}

/// Helper to get the home directory cross-platform
fn get_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

#[tauri::command]
pub fn get_settings() -> Result<serde_json::Value, String> {
    let settings_path = get_settings_path()?;

    if !settings_path.exists() {
        // Return default settings
        return Ok(serde_json::json!({
            "theme": "dark",
            "fontSize": 14,
            "fontFamily": "JetBrains Mono, Fira Code, monospace",
            "tabSize": 4,
            "wordWrap": false,
            "minimap": true,
            "lineNumbers": true,
            "aiProvider": "openrouter",
            "aiModel": "anthropic/claude-sonnet-4",
            "autoSave": true,
            "autoSaveDelay": 1000,
        }));
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub fn set_settings(settings: serde_json::Value) -> Result<(), String> {
    let settings_path = get_settings_path()?;

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}
