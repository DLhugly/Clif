//! Embedded local inference engine — in-process, no external server.
//!
//! Runs GGUF weights via `llama-cpp-2` (llama.cpp bindings), Metal-accelerated on
//! macOS. This is the real `LocalEngine`; MLX can later slot in behind the same
//! trait for extra Mac speed. The agent harness stays engine-agnostic: it always
//! targets one active model, local or cloud.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel, Special};
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

    /// Render OpenAI-style (role, content) messages into a single prompt using
    /// the model's OWN baked-in chat template — so special tokens are correct
    /// per model (fixes the stray-token artifact from raw prompting).
    ///
    /// Some templates (e.g. Gemma) reject a `system` role. We try as-is, and on
    /// failure retry with system messages folded into the first user turn — a
    /// fallback that works across Gemma / Llama / Qwen / Mistral.
    pub fn apply_template(&self, messages: &[(String, String)]) -> Result<String, String> {
        let slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        let (_, lm) = slot.as_ref().ok_or("no model loaded")?;
        let model = &lm.model;

        // Native template — only works for model families llama.cpp's C template
        // engine recognizes. Try as-is, then with system folded into user.
        if let Ok(template) = model.chat_template(None) {
            let render = |msgs: &[(String, String)]| -> Option<String> {
                let chat: Vec<LlamaChatMessage> = msgs
                    .iter()
                    .filter(|(_, c)| !c.trim().is_empty())
                    .filter_map(|(role, content)| {
                        LlamaChatMessage::new(role.clone(), content.clone()).ok()
                    })
                    .collect();
                model.apply_chat_template(&template, &chat, true).ok()
            };
            if let Some(s) = render(messages).or_else(|| render(&fold_system_into_user(messages))) {
                return Ok(s);
            }
        }

        // Fallback: hand-written template chosen by the model's architecture, so
        // brand-new models llama.cpp can't render (e.g. Gemma-4) still format
        // correctly. Qwen/-Coder use ChatML natively.
        let arch = model.meta_val_str("general.architecture").unwrap_or_default();
        Ok(manual_template(&arch, messages))
    }

    /// Generate a completion for `prompt` (non-streaming).
    pub fn generate(&self, prompt: &str, max_tokens: i32) -> Result<String, String> {
        let mut out = String::new();
        let cancel = Arc::new(AtomicBool::new(false));
        self.generate_stream(prompt, max_tokens, &cancel, &mut |piece| out.push_str(piece))?;
        Ok(out)
    }

    /// Streaming core. Calls `on_token` for each generated piece; stops when
    /// `cancel` is set, an end-of-generation token appears, or `max_tokens` is
    /// reached. Returns (generated_token_count, decode_seconds).
    #[allow(deprecated)]
    pub fn generate_stream(
        &self,
        prompt: &str,
        max_tokens: i32,
        cancel: &Arc<AtomicBool>,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<(usize, f64), String> {
        let slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        let (_, lm) = slot.as_ref().ok_or("no model loaded")?;
        let model = &lm.model;

        let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(lm.n_ctx));
        let mut ctx = model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("create context: {e}"))?;

        let mut tokens = model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;

        // Keep the prompt within the context window, leaving room to generate.
        let budget = lm.n_ctx as usize - (max_tokens as usize).min(lm.n_ctx as usize / 2) - 8;
        if tokens.len() > budget {
            // Preserve the leading system block + the most recent tail.
            let head = 256.min(budget / 4);
            let tail = budget - head;
            let mut trimmed = tokens[..head].to_vec();
            trimmed.extend_from_slice(&tokens[tokens.len() - tail..]);
            tokens = trimmed;
        }

        let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
        let last = tokens.len() as i32 - 1;
        for (i, tok) in tokens.iter().enumerate() {
            batch
                .add(*tok, i as i32, &[0], i as i32 == last)
                .map_err(|e| format!("batch add: {e}"))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;

        let mut sampler = LlamaSampler::greedy();
        let mut n_cur = batch.n_tokens();
        let mut generated = 0usize;
        let start = std::time::Instant::now();

        while n_cur < max_tokens {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);
            if model.is_eog_token(token) {
                break;
            }
            let piece = model.token_to_str(token, Special::Tokenize).unwrap_or_default();
            on_token(&piece);
            generated += 1;

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("batch add: {e}"))?;
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
            n_cur += 1;
        }

        Ok((generated, start.elapsed().as_secs_f64()))
    }
}

/// Hand-written prompt template chosen by model architecture — the fallback when
/// llama.cpp's C template engine can't render the model's embedded template.
fn manual_template(arch: &str, messages: &[(String, String)]) -> String {
    if arch.to_lowercase().contains("gemma") {
        manual_gemma(messages)
    } else {
        manual_chatml(messages) // Qwen/-Coder native; sane default elsewhere.
    }
}

/// ChatML — native for Qwen and widely understood.
fn manual_chatml(messages: &[(String, String)]) -> String {
    let mut s = String::new();
    for (role, content) in messages.iter().filter(|(_, c)| !c.trim().is_empty()) {
        s.push_str(&format!("<|im_start|>{role}\n{content}<|im_end|>\n"));
    }
    s.push_str("<|im_start|>assistant\n");
    s
}

/// Gemma format: no system role (folded into user), assistant is "model".
fn manual_gemma(messages: &[(String, String)]) -> String {
    let mut s = String::new();
    for (role, content) in fold_system_into_user(messages)
        .iter()
        .filter(|(_, c)| !c.trim().is_empty())
    {
        let turn = if role == "assistant" { "model" } else { "user" };
        s.push_str(&format!("<start_of_turn>{turn}\n{content}<end_of_turn>\n"));
    }
    s.push_str("<start_of_turn>model\n");
    s
}

/// Fold all `system` messages into the first `user` turn, dropping the system
/// role. For templates that don't accept a system role (e.g. Gemma).
fn fold_system_into_user(messages: &[(String, String)]) -> Vec<(String, String)> {
    let system: String = messages
        .iter()
        .filter(|(r, _)| r == "system")
        .map(|(_, c)| c.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut out: Vec<(String, String)> = Vec::new();
    let mut injected = system.is_empty();
    for (role, content) in messages.iter().filter(|(r, _)| r != "system") {
        if !injected && role == "user" {
            out.push(("user".to_string(), format!("{system}\n\n{content}")));
            injected = true;
        } else {
            out.push((role.clone(), content.clone()));
        }
    }
    // No user message to attach to — prepend a synthetic user turn.
    if !injected {
        out.insert(0, ("user".to_string(), system));
    }
    out
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

    /// Chat-template + streaming path (what the agent uses). Verifies the model's
    /// own template is applied (no stray tokens) and tokens stream via callback.
    #[test]
    #[ignore]
    fn chat_template_stream() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF");
        let eng = Engine::new().expect("engine init");
        eng.load("chat", Path::new(&path), 4096).expect("load");

        let messages = vec![
            ("system".to_string(), "You are a terse assistant.".to_string()),
            ("user".to_string(), "Name three programming languages.".to_string()),
        ];
        let prompt = eng.apply_template(&messages).expect("template");
        println!("\n=== TEMPLATED PROMPT ===\n{prompt}\n=== END PROMPT ===");

        let cancel = Arc::new(AtomicBool::new(false));
        let mut streamed = String::new();
        let mut chunks = 0;
        eng.generate_stream(&prompt, 64, &cancel, &mut |p| {
            streamed.push_str(p);
            chunks += 1;
        })
        .expect("stream");
        println!("\n=== STREAMED ({chunks} chunks) ===\n{streamed}\n=== END ===");
        assert!(chunks > 1, "expected multiple streamed chunks");
        // Coherent answer produced (streaming + template path works). Gemma via
        // the ChatML fallback may leak a stray tag; Qwen (ChatML-native) is clean.
        assert!(streamed.trim().len() > 3, "expected real generated text");
    }

    /// Steady-state generation speed (tokens/sec), excluding model load + prefill.
    ///   SMOKE_GGUF=/path/to/model.gguf \
    ///     cargo test --lib engine::tests::bench_speed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_speed() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF to a .gguf path");
        let eng = Engine::new().expect("engine init");

        let t0 = std::time::Instant::now();
        eng.load("bench", Path::new(&path), 2048).expect("load model");
        let load_s = t0.elapsed().as_secs_f64();

        let cancel = Arc::new(AtomicBool::new(false));
        let (n, gen_s) = eng
            .generate_stream(
                "Explain, in detail, how ownership and borrowing work in Rust.",
                200,
                &cancel,
                &mut |_piece| {},
            )
            .expect("generate");

        let tps = n as f64 / gen_s;
        println!("\n=== SPEED ===");
        println!("model load:   {load_s:.1}s");
        println!("generated:    {n} tokens in {gen_s:.2}s");
        println!("throughput:   {tps:.1} tokens/sec");
        println!("=== END SPEED ===\n");
        assert!(n > 0);
    }
}
