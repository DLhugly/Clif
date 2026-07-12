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
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;

use super::dialect::Dialect;

/// Tokens per forward pass during prefill. llama.cpp hard-aborts the process
/// (`GGML_ASSERT(n_tokens_all <= cparams.n_batch)`) if a single decode exceeds this,
/// so prefill is chunked to match. It bounds compute-buffer size, NOT prompt length.
const N_BATCH: u32 = 512;

/// A loaded model plus a PERSISTENT context, guarded for single-threaded use.
///
/// The context owns the KV cache. Rebuilding it per turn meant allocating and
/// freeing ~6 GB on every single tool round (on top of a 16 GB resident model) and
/// re-prefilling the whole conversation from scratch — slow, and the memory churn
/// was getting the process killed mid-agent-run. Keeping one context alive lets us
/// reuse the KV for the unchanged prompt prefix and decode only what's new.
///
/// SAFETY: `ctx` borrows `model`. The model sits behind a `Box`, so its address is
/// stable across moves, and Rust drops struct fields in declaration order — `ctx` is
/// declared first and therefore always dropped before the `model` it points into.
/// Do not reorder these fields.
pub struct LoadedModel {
    ctx: LlamaContext<'static>,
    /// Tokens currently resident in the KV cache: the last prompt plus everything
    /// generated from it. The next turn's prompt is diffed against this.
    cached: Vec<LlamaToken>,
    model: Box<LlamaModel>,
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
    ///
    /// `n_ctx_cap` is an upper bound, not the value used — the real context window
    /// is derived from what actually fits in RAM next to the weights (see
    /// [`plan_n_ctx`]) and from what the model was trained for.
    pub fn load(&self, id: &str, weights: &Path, n_ctx_cap: u32) -> Result<(), String> {
        crate::logging::log("engine", &format!("load start: {}", weights.display()));
        let t0 = std::time::Instant::now();

        // Offload all layers to the GPU where available (Metal on Mac).
        let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000_000);
        let model = LlamaModel::load_from_file(&self.backend, weights, &model_params)
            .map_err(|e| {
                crate::logging::log("engine", &format!("load FAILED: {e}"));
                format!("load model: {e}")
            })?;

        let total_ram =
            (super::hardware::detect().total_ram_gb * 1024.0 * 1024.0 * 1024.0) as u64;
        let n_ctx = plan_n_ctx(&model, total_ram, n_ctx_cap);
        crate::logging::log(
            "engine",
            &format!(
                "load done in {:.1}s: n_ctx={n_ctx} (trained={}, model={:.1}GB, ram={:.0}GB)",
                t0.elapsed().as_secs_f64(),
                model.n_ctx_train(),
                model.size() as f64 / 1e9,
                total_ram as f64 / 1e9,
            ),
        );

        // Box first so the model has a stable heap address, then build the context
        // once. This KV allocation now happens a single time per model, not once per
        // agent round.
        let model = Box::new(model);
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(n_ctx))
            .with_n_batch(N_BATCH);
        let ctx = model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| {
                crate::logging::log("engine", &format!("context creation FAILED: {e}"));
                format!("create context: {e}")
            })?;

        // SAFETY: `ctx` borrows `*model`, which is boxed (stable address) and stored
        // alongside it in `LoadedModel`, whose field order guarantees `ctx` is
        // dropped first. Erasing the lifetime is what lets the two live together.
        let ctx: LlamaContext<'static> = unsafe { std::mem::transmute(ctx) };
        crate::logging::log("engine", &format!("context ready: n_ctx={n_ctx}"));

        let mut slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        // Drop any previous model+context before installing the new one, so we never
        // hold two full KV caches at once.
        *slot = None;
        *slot = Some((
            id.to_string(),
            LoadedModel { ctx, cached: Vec::new(), model, n_ctx },
        ));
        Ok(())
    }

    /// Context window of the resident model, if any.
    pub fn loaded_ctx(&self) -> Option<u32> {
        self.loaded.lock().ok()?.as_ref().map(|(_, lm)| lm.n_ctx)
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

        let arch = model.meta_val_str("general.architecture").unwrap_or_default();
        let dialect = Dialect::for_arch(&arch);

        // llama.cpp's `apply_chat_template` is a hardcoded C matcher, not a Jinja
        // engine. For an architecture it doesn't know it does not fail loudly — it
        // matches on a substring and renders a NEIGHBOURING family's format. It
        // renders Gemma 4 as Gemma 2/3, which the model was never trained on and
        // which visibly degrades its output. Where we know the dialect ourselves,
        // ours wins.
        if dialect == Dialect::Gemma4 {
            return Ok(dialect.render(messages));
        }

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

        Ok(dialect.render(messages))
    }

    /// The chat/tool dialect of the resident model.
    pub fn dialect(&self) -> Option<Dialect> {
        let slot = self.loaded.lock().ok()?;
        let (_, lm) = slot.as_ref()?;
        let arch = lm
            .model
            .meta_val_str("general.architecture")
            .unwrap_or_default();
        Some(Dialect::for_arch(&arch))
    }

    /// Generate a completion for `prompt` (non-streaming).
    pub fn generate(&self, prompt: &str, max_tokens: i32) -> Result<String, String> {
        let mut out = String::new();
        let cancel = Arc::new(AtomicBool::new(false));
        self.generate_stream(prompt, max_tokens, &[], &cancel, &mut |piece| out.push_str(piece))?;
        Ok(out)
    }

    /// Streaming core. Calls `on_token` for each generated piece; stops when
    /// `cancel` is set, an end-of-generation token appears, or `max_tokens` new
    /// tokens have been produced.
    ///
    /// Generation also halts as soon as any string in `stop` appears in the output
    /// — the tool-calling loop uses this to cut generation dead at `</tool_call>`
    /// instead of letting the model ramble on past its own tool call.
    ///
    /// Returns (prompt_token_count, generated_token_count, decode_seconds).
    #[allow(deprecated)]
    pub fn generate_stream(
        &self,
        prompt: &str,
        max_tokens: i32,
        stop: &[String],
        cancel: &Arc<AtomicBool>,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<(usize, usize, f64), String> {
        let mut slot = self.loaded.lock().map_err(|_| "engine lock poisoned")?;
        let (_, lm) = slot.as_mut().ok_or("no model loaded")?;
        let n_ctx = lm.n_ctx;

        let mut tokens = lm
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;
        if tokens.is_empty() {
            return Ok((0, 0, 0.0));
        }

        // Keep the prompt within the context window, leaving room to generate.
        let budget = n_ctx as usize - (max_tokens as usize).min(n_ctx as usize / 2) - 8;
        if tokens.len() > budget {
            // Preserve the leading system block + the most recent tail.
            let head = 256.min(budget / 4);
            let tail = budget - head;
            let mut trimmed = tokens[..head].to_vec();
            trimmed.extend_from_slice(&tokens[tokens.len() - tail..]);
            tokens = trimmed;
        }

        // --- KV reuse -------------------------------------------------------
        // Each agent round re-sends the whole conversation with a bit appended, so
        // the new prompt almost always shares a long prefix with what's already in
        // the KV cache. Decode only the divergent suffix and keep the rest.
        let mut reuse = common_prefix_len(&lm.cached, &tokens);

        // We need at least one token to decode to produce logits to sample from, so
        // never reuse the entire prompt.
        if reuse >= tokens.len() {
            reuse = tokens.len() - 1;
        }

        // Evict everything at or beyond the divergence point. Positions below it stay
        // valid because they are byte-identical to what produced them.
        //
        // CRITICAL: `llama_memory_seq_rm` returns *false* when a partial removal is
        // not possible — which is routine for sliding-window (iSWA) caches like
        // Gemma's. On false the stale cells REMAIN, so decoding into that range
        // corrupts the cache and takes the process down. Removing a whole sequence
        // never fails, so falling back to a full clear is always safe.
        if reuse > 0 {
            let trimmed = lm
                .ctx
                .clear_kv_cache_seq(Some(0), Some(reuse as u32), None)
                .unwrap_or(false);
            if !trimmed {
                crate::logging::log(
                    "engine",
                    "kv: partial trim refused (sliding-window cache) — full reprefill",
                );
                lm.ctx.clear_kv_cache();
                lm.cached.clear();
                reuse = 0;
            }
        } else {
            // Nothing to reuse — drop the whole sequence (cannot fail).
            lm.ctx.clear_kv_cache();
            lm.cached.clear();
        }

        let prompt_tokens = tokens.len();
        crate::logging::log(
            "engine",
            &format!(
                "generate start: prompt={prompt_tokens} tok, reused={reuse} ({}%), decode={} tok, n_ctx={n_ctx}",
                if prompt_tokens > 0 { reuse * 100 / prompt_tokens } else { 0 },
                prompt_tokens - reuse,
            ),
        );

        // Prefill ONLY the suffix, in n_batch-sized chunks (llama.cpp hard-aborts if a
        // single decode exceeds n_batch). Only the very last token needs logits.
        let mut batch = LlamaBatch::new(N_BATCH as usize, 1);
        let last = tokens.len() - 1;
        for (chunk_idx, chunk) in tokens[reuse..].chunks(N_BATCH as usize).enumerate() {
            batch.clear();
            let base = reuse + chunk_idx * N_BATCH as usize;
            for (i, tok) in chunk.iter().enumerate() {
                let pos = base + i;
                batch
                    .add(*tok, pos as i32, &[0], pos == last)
                    .map_err(|e| format!("batch add: {e}"))?;
            }
            crate::logging::log(
                "engine",
                &format!("prefill chunk {chunk_idx}: pos {base}..{}", base + chunk.len()),
            );
            if let Err(e) = lm.ctx.decode(&mut batch) {
                // Leave no half-written KV behind for the next turn to trust.
                lm.ctx.clear_kv_cache();
                lm.cached.clear();
                return Err(format!("decode: {e}"));
            }
        }
        crate::logging::log("engine", "prefill done; sampling");

        // The KV now holds exactly `tokens`; generated tokens get appended below.
        lm.cached = tokens.clone();

        let mut sampler = LlamaSampler::greedy();
        // Absolute position of the next token. NOT `batch.n_tokens()` — after a
        // chunked prefill that only holds the final chunk's size.
        let mut n_cur = tokens.len() as i32;
        let mut generated = 0usize;
        let mut emitted = String::new();
        let start = std::time::Instant::now();
        // CLIFPAD_DUMP_TOKENS=1 logs each sampled token under both renderings. The two
        // disagree exactly on control tokens (Plaintext yields ""), which is where every
        // marker-matching bug in the stream filter lives.
        let dump = std::env::var("CLIFPAD_DUMP_TOKENS").is_ok();

        // `max_tokens` bounds NEW tokens, not absolute position — `n_cur` starts at
        // the prompt length, so bounding on it would let a long prompt starve the
        // response down to zero tokens. Still stop at the context edge.
        while generated < max_tokens as usize && (n_cur as u32) < n_ctx {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let token = sampler.sample(&lm.ctx, batch.n_tokens() - 1);
            sampler.accept(token);
            if lm.model.is_eog_token(token) {
                break;
            }
            let piece = lm
                .model
                .token_to_str(token, Special::Plaintext)
                .unwrap_or_default();
            if dump {
                let spec = lm
                    .model
                    .token_to_str(token, Special::Tokenize)
                    .unwrap_or_default();
                crate::logging::log(
                    "engine",
                    &format!("tok id={:<8} plain={:?} spec={:?}", token.0, piece, spec),
                );
            }
            on_token(&piece);
            generated += 1;

            // This token is now resident in the KV, so the next turn can reuse it.
            lm.cached.push(token);

            if !stop.is_empty() {
                emitted.push_str(&piece);
                if stop.iter().any(|s| emitted.contains(s.as_str())) {
                    break;
                }
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("batch add: {e}"))?;
            if let Err(e) = lm.ctx.decode(&mut batch) {
                lm.ctx.clear_kv_cache();
                lm.cached.clear();
                return Err(format!("decode: {e}"));
            }
            n_cur += 1;
        }

        crate::logging::log(
            "engine",
            &format!(
                "generate done: {generated} tok in {:.1}s ({} cached)",
                start.elapsed().as_secs_f64(),
                lm.cached.len()
            ),
        );
        Ok((prompt_tokens, generated, start.elapsed().as_secs_f64()))
    }
}

/// How many leading tokens two sequences share — the slice of KV cache that stays
/// valid when the prompt grows by an appended turn.
fn common_prefix_len(a: &[LlamaToken], b: &[LlamaToken]) -> usize {
    a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
}

/// Choose a context window that actually fits alongside the weights.
///
/// A fixed constant is wrong here: KV cache grows linearly with context and its
/// per-token cost swings by an order of magnitude across architectures. But the
/// estimate below is only an *approximation*, and getting it wrong OOMs the GPU
/// and kills the process — so it is deliberately pessimistic in three ways:
///
///  1. `head_dim` is NOT reliably `n_embd / n_head`. Gemma decouples them (real
///     head_dim 256 vs. a derived 128), which is exactly how an earlier version of
///     this function handed out an 88k window that needed 19 GB of KV and crashed.
///     We take the larger of the derived value and a 256 floor.
///  2. A 2x safety factor on top, to absorb architectures we still model badly
///     (llama.cpp does not necessarily shrink sliding-window layers, either).
///  3. We budget against a fraction of RAM, because the GPU's usable working set
///     is well below total system memory (~38 GB of 48 GB on Apple Silicon).
///
/// Erring small costs a little context. Erring large costs the whole app.
fn plan_n_ctx(model: &LlamaModel, total_ram_bytes: u64, n_ctx_cap: u32) -> u32 {
    const MIN_CTX: u32 = 4096;
    // Past this, prefill latency dominates and quality degrades anyway. Raising it
    // is not worth flirting with the memory ceiling.
    const MAX_CTX: u32 = 32_768;
    /// Keep total GPU residency (weights + KV + compute buffers) well under the
    /// Metal working set, which is smaller than physical RAM.
    const USABLE_FRACTION: f64 = 0.55;
    const SAFETY: u64 = 2;

    let trained = model.n_ctx_train().max(MIN_CTX);

    let derived_head_dim = (model.n_embd() as u64) / (model.n_head() as u64).max(1);
    let head_dim = derived_head_dim.max(256);

    let kv_per_token = (model.n_layer() as u64)
        * (model.n_head_kv() as u64)
        * head_dim
        * 2 // K and V
        * 2 // f16
        * SAFETY;

    if kv_per_token == 0 {
        return MIN_CTX.min(trained).min(n_ctx_cap.max(MIN_CTX));
    }

    let usable = (total_ram_bytes as f64 * USABLE_FRACTION) as u64;
    let for_kv = usable.saturating_sub(model.size());
    let fits = for_kv / kv_per_token;

    let n = fits
        .min(trained as u64)
        .min(MAX_CTX as u64)
        .min(n_ctx_cap as u64) as u32;

    // Round to a multiple of 256, then hold a workable floor.
    let n = (n / 256) * 256;
    n.max(MIN_CTX).min(trained).min(n_ctx_cap.max(MIN_CTX))
}

/// ChatML — native for Qwen and widely understood.
#[allow(dead_code)]
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
        eng.generate_stream(&prompt, 64, &[], &cancel, &mut |p| {
            streamed.push_str(p);
            chunks += 1;
        })
        .expect("stream");
        println!("\n=== STREAMED ({chunks} chunks) ===\n{streamed}\n=== END ===");
        assert!(chunks > 1, "expected multiple streamed chunks");
        assert!(streamed.trim().len() > 3, "expected real generated text");
        // Control tokens must never reach the user — they render as `<|channel|>`,
        // `<|im_end|>`, `<end_of_turn>` etc. in the chat bubble.
        for leak in ["<|", "<start_of_turn>", "<end_of_turn>"] {
            assert!(
                !streamed.contains(leak),
                "control token {leak:?} leaked into output: {streamed}"
            );
        }
    }

    /// Regression: a prompt longer than `n_batch` (512) used to hard-abort the
    /// process inside llama.cpp — `GGML_ASSERT(n_tokens_all <= cparams.n_batch)`.
    /// The agent's system prompt (with tool schemas) is well past that, so this is
    /// the exact path that crashed on every real local turn. Prefill is chunked now.
    ///   SMOKE_GGUF=/path/to/model.gguf \
    ///     cargo test --lib engine::tests::long_prompt_does_not_abort -- --ignored --nocapture
    #[test]
    #[ignore]
    fn long_prompt_does_not_abort() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF to a .gguf path");
        let eng = Engine::new().expect("engine init");
        eng.load("longprompt", Path::new(&path), 4096).expect("load model");

        // ~2000 tokens — comfortably past n_batch, like the real agent prompt.
        let filler = "The quick brown fox jumps over the lazy dog. ".repeat(200);
        let prompt = format!("{filler}\n\nReply with the single word: OK");

        let cancel = Arc::new(AtomicBool::new(false));
        let (prompt_n, gen_n, _s) = eng
            .generate_stream(&prompt, 16, &[], &cancel, &mut |_| {})
            .expect("long prompt must not abort");

        println!("prompt tokens: {prompt_n}, generated: {gen_n}");
        assert!(prompt_n > 512, "prompt must exceed n_batch to test the fix");
        assert!(gen_n > 0, "expected tokens despite the long prompt");
    }

    /// What context window auto-sizing actually picks for a real model on this
    /// machine — and that it stays inside what the model was trained for.
    ///   SMOKE_GGUF=/path/to/model.gguf \
    ///     cargo test --lib engine::tests::auto_context_fits_ram -- --ignored --nocapture
    #[test]
    #[ignore]
    fn auto_context_fits_ram() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF to a .gguf path");
        let eng = Engine::new().expect("engine init");
        eng.load("auto", Path::new(&path), u32::MAX).expect("load model");

        let n_ctx = eng.loaded_ctx().expect("a model is resident");
        println!("\n=== AUTO CONTEXT ===\nchosen n_ctx: {n_ctx}\n=== END ===\n");

        assert!(n_ctx >= 4096, "should never fall below the 4k floor");

        // The real check is that the window FITS. An earlier version happily chose
        // 88k, which needed 19 GB of KV on top of a 16 GB model and killed the GPU.
        // Actually generating proves the allocation succeeded.
        let cancel = Arc::new(AtomicBool::new(false));
        let (_p, gen_n, _s) = eng
            .generate_stream("Reply with the single word: OK", 8, &[], &cancel, &mut |_| {})
            .expect("chosen context must actually allocate and run");
        assert!(gen_n > 0, "generation must work at the chosen context size");
    }

    /// The KV-reuse win: a second turn that appends to the first must re-decode only
    /// the appended tokens, not the whole conversation. Before this, every agent round
    /// rebuilt the context and re-prefilled from scratch (~6 GB of KV churn per round).
    ///   SMOKE_GGUF=/path/to/model.gguf \
    ///     cargo test --lib engine::tests::kv_cache_is_reused -- --ignored --nocapture
    #[test]
    #[ignore]
    fn kv_cache_is_reused() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF");
        let eng = Engine::new().expect("engine init");
        eng.load("kv", Path::new(&path), 8192).expect("load");
        let cancel = Arc::new(AtomicBool::new(false));

        // Deliberately longer than Gemma's 1024-token sliding window. Reuse *inside*
        // the window trims fine; reuse *beyond* it is where `llama_memory_seq_rm`
        // refuses the partial removal — the case that actually killed the process.
        let base = format!(
            "{}\n\nUser: say OK\nAssistant:",
            "Context line about the codebase and its many modules. ".repeat(400)
        );
        let t0 = std::time::Instant::now();
        let (p1, g1, _) = eng
            .generate_stream(&base, 16, &[], &cancel, &mut |_| {})
            .expect("turn 1");
        let cold = t0.elapsed().as_secs_f64();
        assert!(p1 > 512, "prompt should exceed one batch");
        assert!(g1 > 0);

        // Turn 2 shares the entire first prompt as a prefix — only the new tail differs.
        let followup = format!("{base} OK\nUser: say OK again\nAssistant:");
        let t1 = std::time::Instant::now();
        let (p2, g2, _) = eng
            .generate_stream(&followup, 16, &[], &cancel, &mut |_| {})
            .expect("turn 2");
        let warm = t1.elapsed().as_secs_f64();

        println!("\n=== KV REUSE ===");
        println!("turn 1: {p1} prompt tok, {g1} gen, {cold:.2}s (cold)");
        println!("turn 2: {p2} prompt tok, {g2} gen, {warm:.2}s (warm)");
        println!("=== END ===\n");

        assert!(g2 > 0, "second turn must still generate");
        // The reuse is verified by the engine's own `reused=` log line; here we assert
        // the observable consequence: the warm turn is not paying a full re-prefill.
        assert!(
            warm < cold,
            "warm turn ({warm:.2}s) should beat cold ({cold:.2}s) — KV was not reused"
        );

        // Several more turns, each appending to the last — this is what an agent loop
        // actually does. An earlier version survived turn 2 and then took the process
        // down here, because `llama_memory_seq_rm` returns false on sliding-window
        // caches and we decoded into a KV it had refused to trim.
        let mut convo = followup;
        for turn in 3..=6 {
            convo.push_str(" OK\nUser: again\nAssistant:");
            let (_p, g, _s) = eng
                .generate_stream(&convo, 12, &[], &cancel, &mut |_| {})
                .unwrap_or_else(|e| panic!("turn {turn} failed: {e}"));
            assert!(g > 0, "turn {turn} generated nothing");
        }
    }

    /// Ground truth: what does the model ACTUALLY emit, token by token, and how does
    /// each render under Plaintext vs Tokenize? Control tokens render as EMPTY under
    /// Plaintext, which silently destroys the very markers (`<|channel>`, `<|tool_call>`)
    /// that the stream filter and stop-sequence logic depend on seeing.
    ///   SMOKE_GGUF=... cargo test --lib engine::tests::dump_raw_tokens -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_raw_tokens() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF");
        let eng = Engine::new().expect("engine init");
        eng.load("raw", Path::new(&path), 4096).expect("load");

        std::env::set_var("CLIFPAD_DUMP_TOKENS", "1");

        // Round-4 shape: the turn that degenerates in the app is the one AFTER a tool
        // response has been fed back. Reproduce that, not a clean first turn.
        let d = Dialect::Gemma4;
        let msgs = vec![
            // The REAL system prompt the app sends — it teaches a generic
            // `<tool_call>{json}</tool_call>` protocol that Gemma 4 never saw in
            // training, and which collides with its native `<|tool_call>call:…` form.
            (
                "system".to_string(),
                crate::commands::agent::local_tool_instructions(
                    crate::commands::agent::AgentMode::Agent,
                ),
            ),
            (
                "user".to_string(),
                "List the files in the current directory, then tell me what you found."
                    .to_string(),
            ),
            (
                "assistant".to_string(),
                "<|tool_call>call:list_files(path=\".\")<tool_call|>".to_string(),
            ),
            (
                "user".to_string(),
                d.format_tool_response("list_files", "index.html\nstyle.css"),
            ),
            (
                "assistant".to_string(),
                "<|tool_call>call:read_file(path=\"index.html\")<tool_call|>".to_string(),
            ),
            // The round that degenerates in the app: the tool result is HTML. Its raw
            // `<`/`>` land inside Gemma's `<|"|>…<|"|>` string delimiters.
            (
                "user".to_string(),
                d.format_tool_response(
                    "read_file",
                    "<!DOCTYPE html>\n<html>\n<head>\n  <title>Dragons</title>\n  \
                     <link rel=\"stylesheet\" href=\"style.css\">\n</head>\n<body>\n  \
                     <h1>Dragons</h1>\n  <div class=\"hero\">\n    <p>Welcome.</p>\n  \
                     </div>\n</body>\n</html>",
                ),
            ),
        ];
        let prompt = eng.apply_template(&msgs).expect("template");
        println!("\n=== RENDERED PROMPT ===\n{prompt}\n=== END PROMPT ===\n");

        let cancel = Arc::new(AtomicBool::new(false));
        let mut plain_stream = String::new();
        eng.generate_stream(&prompt, 96, &[], &cancel, &mut |t| plain_stream.push_str(t))
            .expect("generate");

        println!("\n=== PLAINTEXT STREAM (what the stream filter actually receives) ===");
        println!("{plain_stream:?}");
        println!("=== END (per-token dump is in the ClifPad log) ===\n");
    }

    /// The agent loop, faithfully: ONE engine, many `generate_stream` calls, each with
    /// the conversation grown by the previous round's output + a tool response — i.e.
    /// every round decodes into a KV cache left behind by the last one.
    ///
    /// The prior KV test asserted *speed*. Speed is not correctness: a corrupted cache
    /// is fast and wrong. This asserts the model still produces clean text by round 4,
    /// which is where the app degenerates into `<thought` spam.
    ///   SMOKE_GGUF=... cargo test --lib engine::tests::multi_round_output_stays_clean \
    ///     -- --ignored --nocapture
    #[test]
    #[ignore]
    fn multi_round_output_stays_clean() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF");
        let eng = Engine::new().expect("engine init");
        eng.load("multi", Path::new(&path), 8192).expect("load");

        let d = Dialect::Gemma4;
        let cancel = Arc::new(AtomicBool::new(false));
        let mut msgs = vec![
            (
                "system".to_string(),
                crate::commands::agent::local_tool_instructions(
                    crate::commands::agent::AgentMode::Agent,
                ),
            ),
            (
                "user".to_string(),
                "Look at index.html and tell me how to improve it.".to_string(),
            ),
        ];

        // Canned tool results, so the only thing varying across rounds is the KV cache.
        let results = [
            ("list_files", "index.html\nstyle.css"),
            ("read_file", "<!DOCTYPE html>\n<html>\n<head>\n  <title>Dragons</title>\n</head>\n<body>\n  <h1>Dragons</h1>\n</body>\n</html>"),
            ("list_files", "index.html\nstyle.css"),
            ("read_file", "body { margin: 0; }"),
        ];

        for (round, (tool, result)) in results.iter().enumerate() {
            let prompt = d.render(&msgs);
            let mut text = String::new();
            eng.generate_stream(&prompt, 256, &d.stop_sequences(), &cancel, &mut |t| {
                text.push_str(t)
            })
            .expect("generate");

            // The raw stream legitimately opens a thought channel — that is the model's
            // trained format. What matters is what survives into the chat and into the
            // history, so assert on the stripped text.
            let visible = d.strip_hidden(&text);
            let n_msgs = msgs.len();
            println!(
                "\n--- round {round} ({n_msgs} msgs) ---\nraw:     {text:?}\nvisible: {visible:?}"
            );

            // These are the exact markers the user saw spammed in the chat bubble.
            for bad in ["<thought", "channel|>", "<|channel>"] {
                assert!(
                    !visible.contains(bad),
                    "round {round}: {bad:?} leaked into the chat — visible was {visible:?}"
                );
            }
            assert!(
                !visible.trim().is_empty(),
                "round {round}: model produced no usable output — raw was {text:?}"
            );

            msgs.push(("assistant".to_string(), visible));
            msgs.push(("user".to_string(), d.format_tool_response(tool, result)));
        }
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
        let (_prompt_n, n, gen_s) = eng
            .generate_stream(
                "Explain, in detail, how ownership and borrowing work in Rust.",
                200,
                &[],
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

    /// What prompt do we ACTUALLY feed the model? llama.cpp's template engine is a
    /// hardcoded C matcher, not Jinja — if it doesn't recognise the architecture we
    /// silently fall back to a hand-written template, which may be the wrong dialect.
    #[test]
    #[ignore]
    fn dump_rendered_prompt() {
        let path = std::env::var("SMOKE_GGUF").expect("set SMOKE_GGUF");
        let eng = Engine::new().expect("engine init");
        eng.load("tpl", Path::new(&path), 4096).expect("load");

        let msgs = vec![
            ("system".to_string(), "You are Clif.".to_string()),
            ("user".to_string(), "Hi".to_string()),
        ];
        let prompt = eng.apply_template(&msgs).expect("template");
        println!("\n=== RENDERED PROMPT ===\n{prompt}\n=== END ===\n");
    }

}
