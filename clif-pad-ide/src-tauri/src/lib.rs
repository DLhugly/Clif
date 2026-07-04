mod commands;
mod services;
mod state;

use commands::lsp::LspState;
use commands::pty::PtyState;
use services::file_watcher::WatcherState;
use tauri::{Emitter, Manager};

fn build_menu(app: &tauri::AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, MenuItemBuilder};

    let about_item = MenuItemBuilder::with_id("about_clif", "About ClifPad")
        .build(app)?;

    let new_window = MenuItemBuilder::with_id("new_window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;

    // On macOS the first submenu becomes the app menu (bold "ClifPad" in the menu bar)
    let app_menu = SubmenuBuilder::new(app, "ClifPad")
        .item(&about_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()
}

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyState::new())
        .manage(LspState::default())
        .manage(WatcherState::new())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "new_window" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = commands::window::create_window(app).await;
                    });
                }
                "about_clif" => {
                    let _ = app.emit("show-about", ());
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                let app = window.app_handle();

                // Clean up PTY sessions for this window
                if let Some(pty_state) = app.try_state::<PtyState>() {
                    pty_state.kill_all_for_window(&label);
                }
                // Kill all active agent sessions
                commands::agent::kill_all_agent_sessions();

                // Clean up file watchers for this window
                if let Some(watcher_state) = app.try_state::<WatcherState>() {
                    services::file_watcher::stop_all_for_window(&watcher_state, &label);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_dir,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::rename_entry,
            commands::fs::delete_entry,
            commands::fs::watch_dir,
            commands::fs::reveal_path,
            commands::fs::paste_file,
            commands::ai::ai_chat,
            commands::ai::ai_complete,
            commands::ai::get_models,
            commands::ai::set_api_key,
            commands::ai::get_api_key,
            commands::ai::generate_commit_message,
            commands::ai::ai_review_code,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_diff_cached,
            commands::git::git_commit,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_create_branch,
            commands::git::git_ahead_behind,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_diff_stat,
            commands::git::git_diff_numstat,
            commands::git::git_show,
            commands::git::git_init,
            commands::git::git_clone,
            commands::git::git_log,
            commands::git::git_remote_url,
            commands::search::search_files,
            commands::claude_code::claude_code_start,
            commands::claude_code::claude_code_send,
            commands::claude_code::claude_code_stop,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::save_agent_history,
            commands::settings::load_agent_history,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::window::create_window,
            commands::agent::agent_chat,
            commands::agent::agent_stop,
            commands::agent::agent_approve_command,
            commands::agent::agent_clear_todos,
            commands::agent::agent_clear_conversation,
            commands::indexer::index_build,
            commands::indexer::index_status,
            commands::indexer::index_find_symbol,
            commands::indexer::index_search,
            commands::indexer::index_touch_file,
            commands::agent::clif_project_initialized,
            commands::agent::clif_read_context,
            commands::agent::clif_init_project,
            commands::security::scan_files_security,
            commands::security::scan_repo_security,
            commands::lsp::lsp_start,
            commands::lsp::lsp_send,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_check_servers,
            commands::gh::gh_check_available,
            commands::gh::gh_list_prs,
            commands::gh::gh_pr_detail,
            commands::local_models::local_detect_hardware,
            commands::local_models::local_models_catalog,
            commands::local_models::local_models_list,
            commands::local_models::local_model_resolve,
            commands::local_models::local_model_variants,
            commands::local_models::local_models_search,
            commands::local_models::local_model_download,
            commands::local_models::local_model_delete,
            commands::local_models::local_model_set_active,
            commands::local_models::local_model_active,
            commands::local_models::local_scan_existing,
            commands::local_models::local_engine_status,
            commands::local_models::local_engine_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
