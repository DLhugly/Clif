mod commands;
mod services;
mod state;

use commands::pty::PtyState;
use services::file_watcher::WatcherState;
use state::AppState;
use std::sync::Mutex;

pub fn run() {
    let app_state = AppState {
        project_root: Mutex::new(None),
        open_files: Mutex::new(std::collections::HashMap::new()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .manage(PtyState::new())
        .manage(WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_dir,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::rename_entry,
            commands::fs::delete_entry,
            commands::fs::watch_dir,
            commands::ai::ai_chat,
            commands::ai::ai_complete,
            commands::ai::get_models,
            commands::ai::set_api_key,
            commands::ai::get_api_key,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_diff_stat,
            commands::git::git_diff_numstat,
            commands::git::git_init,
            commands::git::git_log,
            commands::search::search_files,
            commands::claude_code::claude_code_start,
            commands::claude_code::claude_code_send,
            commands::claude_code::claude_code_stop,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
