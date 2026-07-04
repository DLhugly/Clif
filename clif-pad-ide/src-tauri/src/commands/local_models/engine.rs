//! Embedded local inference engine — in-process, no external server.
//!
//! Runs GGUF weights via `llama-cpp-2` (llama.cpp bindings), Metal-accelerated on
//! macOS. This is the real `LocalEngine`; MLX can later slot in behind the same
//! trait for extra Mac speed. The agent harness stays engine-agnostic: it always
//! targets one active model, local or cloud.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Mutex;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;

/// A loaded model + its context, guarded for single-threaded generation.
pub struct LoadedModel {
    model: LlamaModel,
    n_ctx: u32,
}

/// Process-wide engine. The llama.cpp backend is initialized once.
pub struct Engine {
    backend: LlamaBackend,
    loaded: Mutex<Option<(String, LoadedModel)>>, // (model id, model)
}

impl Engine {
    pub fn new() -> Result<Self, String> {
        let backend = LlamaBackend::init().map_err(|e| format!("llama backend init: {e}"))?;
        Ok(Self {
            backend,
            loaded: Mutex::new(None),
        })
    }

    pub fn loaded_id(&self) -> Option<String> {
        self.loaded.lock().ok()?.as_ref().map(|(id, _)| id.clone())
    }

    /// Load a GGUF file, replacing any currently-resident model.
    pub fn load(&self, id: &str, weights: &Path, n_ctx: u32) -> Result<(), String> {
        // Offload all layers to the GPU where available (Metal on Mac).
        let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000_000);
        let model = LlamaModel::load_from_file(&self.backend, weights, &model_params)
            .map_err(|e| format!("load model: {e}"))?;

        let mut slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        *slot = Some((id.to_string(), LoadedModel { model, n_ctx }));
        Ok(())
    }

    #[allow(dead_code)]
    pub fn unload(&self) {
        if let Ok(mut slot) = self.loaded.lock() {
            *slot = None;
        }
    }

    /// Generate a completion for `prompt` (non-streaming). Proves the model runs
    /// in-process; the streaming + tool-call path wires in next.
    #[allow(deprecated)]
    pub fn generate(&self, prompt: &str, max_tokens: i32) -> Result<String, String> {
        let slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        let (_, lm) = slot.as_ref().ok_or("no model loaded")?;
        let model = &lm.model;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(lm.n_ctx));
        let mut ctx = model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("create context: {e}"))?;

        let tokens = model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;

        let mut batch = LlamaBatch::new(512, 1);
        let last = tokens.len() as i32 - 1;
        for (i, tok) in tokens.iter().enumerate() {
            batch
                .add(*tok, i as i32, &[0], i as i32 == last)
                .map_err(|e| format!("batch add: {e}"))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;

        let mut sampler = LlamaSampler::greedy();
        let mut n_cur = batch.n_tokens();
        let mut out = String::new();

        while n_cur < max_tokens {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);
            if model.is_eog_token(token) {
                break;
            }
            let piece = model
                .token_to_str(token, Special::Tokenize)
                .unwrap_or_default();
            out.push_str(&piece);

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("batch add: {e}"))?;
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
            n_cur += 1;
        }

        Ok(out)
    }
}

// The backend/model hold raw pointers; access is serialized via the Mutex and a
// single global engine, so it is safe to share across Tauri's command threads.
unsafe impl Send for Engine {}
unsafe impl Sync for Engine {}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-process inference smoke test. Ignored by default (loads a multi-GB
    /// model). Run with a real GGUF:
    ///   SMOKE_GGUF=/path/to/model.gguf \
    ///     cargo test --lib engine::tests::smoke_generate -- --ignored --nocapture
    #[test]
    #[ignore]
    fn smoke_generate() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF to a .gguf path");
        let eng = Engine::new().expect("engine init");
        eng.load("smoke", Path::new(&path), 2048).expect("load model");
        let out = eng
            .generate("Write one short sentence about the Rust language.", 48)
            .expect("generate");
        println!("\n=== MODEL OUTPUT ===\n{out}\n=== END OUTPUT ===\n");
        assert!(!out.trim().is_empty(), "expected non-empty generation");
    }
}
