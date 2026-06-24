//! Local inference engine seam.
//!
//! v1 defines the trait and a not-yet-implemented stub. The real implementations
//! are platform-split (PRD §4.1):
//!   - macOS:        MLX via `mlx-rs` / build on `mlxcel`  (fastest on Apple Silicon)
//!   - Windows/Linux: `llama-cpp-4` (or `mistral.rs`)
//!
//! Both are in-process and will be reached through this trait so the rest of the
//! app — and the agent harness — stays engine-agnostic. The harness always talks
//! to ONE active model; local vs cloud (OpenRouter) is just a different backend.

#![allow(dead_code)]

use std::path::Path;

/// A loaded, ready-to-generate local model.
pub trait LocalEngine: Send + Sync {
    /// Load weights from disk into the runtime.
    fn load(&mut self, weights: &Path) -> Result<(), String>;

    /// Whether a model is currently resident.
    fn is_loaded(&self) -> bool;

    /// Free the resident model.
    fn unload(&mut self);

    /// Human label of the engine implementation (e.g. "mlx", "llama.cpp").
    fn backend_name(&self) -> &'static str;
}

/// Selects the platform-appropriate engine. Returns the stub until the real
/// MLX / llama.cpp implementations land.
pub fn default_engine() -> Box<dyn LocalEngine> {
    Box::new(StubEngine::default())
}

#[derive(Default)]
pub struct StubEngine {
    loaded: bool,
}

impl LocalEngine for StubEngine {
    fn load(&mut self, _weights: &Path) -> Result<(), String> {
        Err("local inference engine not yet implemented (v1 manages download \
             + selection; MLX/llama.cpp integration is the next milestone)"
            .into())
    }
    fn is_loaded(&self) -> bool {
        self.loaded
    }
    fn unload(&mut self) {
        self.loaded = false;
    }
    fn backend_name(&self) -> &'static str {
        #[cfg(target_os = "macos")]
        {
            "mlx (pending)"
        }
        #[cfg(not(target_os = "macos"))]
        {
            "llama.cpp (pending)"
        }
    }
}
