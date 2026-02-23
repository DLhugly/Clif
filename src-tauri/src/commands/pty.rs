use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct PtyState {
    sessions: Mutex<HashMap<String, PtySession>>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    kill_flag: Arc<Mutex<bool>>,
}

impl PtyState {
    pub fn new() -> Self {
        PtyState {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct PtyOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyExit {
    session_id: String,
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    working_dir: Option<String>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell for proper env

    if let Some(dir) = &working_dir {
        cmd.cwd(dir);
    }

    // Set TERM for proper color support
    cmd.env("TERM", "xterm-256color");
    // Remove CLAUDECODE so `claude` CLI doesn't think it's nested
    cmd.env_remove("CLAUDECODE");
    // Remove npm_config_prefix to avoid fnm/nvm conflicts
    cmd.env_remove("npm_config_prefix");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Drop slave — we only need the master side
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let kill_flag = Arc::new(Mutex::new(false));
    let kill_flag_clone = kill_flag.clone();

    let session = PtySession {
        writer,
        master: pair.master,
        child,
        kill_flag: kill_flag.clone(),
    };

    let state = app.state::<PtyState>();
    state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .insert(session_id.clone(), session);

    // Spawn reader thread to stream output
    let sid = session_id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 32768]; // 32KB buffer for heavy TUI output
        loop {
            // Check kill flag
            if *kill_flag_clone.lock().unwrap_or_else(|e| e.into_inner()) {
                break;
            }

            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — shell exited
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    // EIO is normal on macOS when the child exits
                    let kind = e.kind();
                    if kind == std::io::ErrorKind::Other || kind == std::io::ErrorKind::BrokenPipe {
                        break;
                    }
                    // Brief pause before retrying on transient errors
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        }

        // Emit exit event so the frontend knows the session died
        let _ = app_clone.emit(
            "pty-exit",
            PtyExit {
                session_id: sid.clone(),
            },
        );
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn pty_write(
    app: AppHandle,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn pty_resize(
    app: AppHandle,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn pty_kill(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut session) = sessions.remove(&session_id) {
        // Signal the reader thread to stop
        if let Ok(mut flag) = session.kill_flag.lock() {
            *flag = true;
        }
        // Kill the child process
        let _ = session.child.kill();
        drop(session);
    }

    Ok(())
}
