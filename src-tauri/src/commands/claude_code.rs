use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use uuid::Uuid;

/// Find the claude binary by checking common install locations
fn resolve_claude_path() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let candidates = [
            format!("{}/.local/bin/claude", home),
            format!("{}/.claude/local/claude", home),
            format!("{}/.nvm/versions/node/default/bin/claude", home),
            "/usr/local/bin/claude".to_string(),
            "/opt/homebrew/bin/claude".to_string(),
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                return path.clone();
            }
        }
    }
    "claude".to_string()
}

// Global store for running Claude Code processes
static SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(serde::Serialize, Clone)]
struct ClaudeCodeEvent {
    session_id: String,
    event_type: String,
    data: String,
}

#[tauri::command]
pub async fn claude_code_start(
    app: tauri::AppHandle,
    task: String,
    working_dir: String,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let sid = session_id.clone();

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut sessions = SESSIONS
            .lock()
            .map_err(|e| format!("Failed to lock sessions: {}", e))?;
        sessions.insert(session_id.clone(), cancel_tx);
    }

    let app_handle = app.clone();

    tokio::spawn(async move {
        let result = run_claude_process(app_handle.clone(), &sid, &task, &working_dir, cancel_rx).await;

        if let Err(e) = result {
            let _ = app_handle.emit(
                "claude-code-output",
                ClaudeCodeEvent {
                    session_id: sid.clone(),
                    event_type: "error".to_string(),
                    data: e,
                },
            );
        }

        let _ = app_handle.emit(
            "claude-code-output",
            ClaudeCodeEvent {
                session_id: sid.clone(),
                event_type: "done".to_string(),
                data: String::new(),
            },
        );

        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.remove(&sid);
        }
    });

    Ok(session_id)
}

async fn run_claude_process(
    app: tauri::AppHandle,
    session_id: &str,
    task: &str,
    working_dir: &str,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let claude_bin = resolve_claude_path();

    // Use --verbose and pipe through to get real-time output
    let mut child = Command::new(&claude_bin)
        .arg("-p")
        .arg(task)
        .current_dir(working_dir)
        .env("TERM", "dumb")
        .env("NO_COLOR", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn claude at '{}': {}", claude_bin, e))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child.stderr.take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    let sid = session_id.to_string();
    let app_stdout = app.clone();
    let sid_stdout = sid.clone();

    // Spawn a task to read stdout in raw chunks
    let stdout_handle = tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_stdout.emit(
                        "claude-code-output",
                        ClaudeCodeEvent {
                            session_id: sid_stdout.clone(),
                            event_type: "output".to_string(),
                            data: text,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let app_stderr = app.clone();
    let sid_stderr = sid.clone();

    // Spawn a task to read stderr in raw chunks
    let stderr_handle = tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stderr);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_stderr.emit(
                        "claude-code-output",
                        ClaudeCodeEvent {
                            session_id: sid_stderr.clone(),
                            event_type: "error".to_string(),
                            data: text,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Wait for either cancellation or process completion
    tokio::select! {
        _ = &mut cancel_rx => {
            let _ = child.kill().await;
        }
        _ = child.wait() => {}
    }

    // Wait for readers to finish draining
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    Ok(())
}

#[tauri::command]
pub async fn claude_code_send(_session_id: String, _input: String) -> Result<(), String> {
    Err("Interactive input is not supported in --print mode".to_string())
}

#[tauri::command]
pub async fn claude_code_stop(session_id: String) -> Result<(), String> {
    let cancel_tx = {
        let mut sessions = SESSIONS
            .lock()
            .map_err(|e| format!("Failed to lock sessions: {}", e))?;
        sessions.remove(&session_id)
    };

    match cancel_tx {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err(format!("Session not found: {}", session_id)),
    }
}
