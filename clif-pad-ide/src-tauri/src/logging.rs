//! Dev/crash logging for the embedded local-model engine.
//!
//! llama.cpp failures are hard aborts (`GGML_ASSERT` → `abort()`), which kill the
//! process without unwinding — no Rust panic, no stack trace in our code, nothing.
//! The only reliable diagnostic is a breadcrumb trail flushed to disk *before* each
//! risky operation, so the last line of the log names the operation that died.
//!
//! Three streams converge on one file:
//!   - `log(component, msg)` breadcrumbs from our engine/agent code (flushed per line)
//!   - llama.cpp/GGML internal logs, captured via `llama_cpp_2::send_logs_to_tracing`
//!   - Rust panics, via a panic hook (with backtrace)

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: OnceLock<Mutex<File>> = OnceLock::new();

/// Rotate rather than grow forever; one previous generation is kept.
const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

pub fn log_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        home.join("Library").join("Logs").join("ClifPad")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(home)
            .join("clif-pad")
            .join("logs")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("state"))
            .join("clif-pad")
            .join("logs")
    }
}

pub fn log_path() -> PathBuf {
    log_dir().join("clifpad.log")
}

/// HH:MM:SS.mmm (UTC). Enough to order events; the session-start line carries the
/// full epoch for absolute anchoring.
fn timestamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60,
        now.subsec_millis()
    )
}

/// Append one line and flush immediately. Cheap enough for breadcrumbs; the flush
/// is the whole point — an abort must not be able to eat the trail.
pub fn log(component: &str, msg: &str) {
    if let Some(m) = LOG.get() {
        if let Ok(mut f) = m.lock() {
            let _ = writeln!(f, "[{}] [{component}] {msg}", timestamp());
            let _ = f.flush();
        }
    }
}

/// `io::Write` adapter so the tracing subscriber (llama.cpp logs) shares our file.
struct SharedWriter;

impl io::Write for SharedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Some(m) = LOG.get() {
            if let Ok(mut f) = m.lock() {
                let _ = f.write_all(buf);
                let _ = f.flush();
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub fn init() {
    let dir = log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = log_path();

    // Rotate a grown log instead of truncating history mid-investigation.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = std::fs::rename(&path, dir.join("clifpad.log.1"));
        }
    }

    let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) else {
        eprintln!("[clifpad] could not open log file at {}", path.display());
        return;
    };
    let _ = LOG.set(Mutex::new(file));

    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    log(
        "app",
        &format!(
            "=== ClifPad start — pid {} · epoch {epoch} · v{} ===",
            std::process::id(),
            env!("CARGO_PKG_VERSION")
        ),
    );
    eprintln!("[clifpad] logging to {}", path.display());

    // Rust panics: log with backtrace, then defer to the previous hook so default
    // stderr behavior is preserved.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let bt = std::backtrace::Backtrace::force_capture();
        log("panic", &format!("{info}\n{bt}"));
        prev(info);
    }));

    // llama.cpp/GGML internal logs → tracing → our file. This is what put the
    // KV-cache sizes and n_ctx lines on disk when diagnosing the OOM crash.
    let _ = tracing_subscriber::fmt()
        .with_writer(|| SharedWriter)
        .with_ansi(false)
        .with_target(true)
        .with_max_level(tracing::Level::INFO)
        .try_init();
    llama_cpp_2::send_logs_to_tracing(llama_cpp_2::LogOptions::default());
}
