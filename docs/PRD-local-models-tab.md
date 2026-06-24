# PRD: Local Models Tab + Embedded LLM Runtime

Status: Draft · Owner: James Lawrence · Branch: `feature/local-models-tab`

## 1. Overview

**Goal**
Add first-class support for running strong local LLMs directly inside ClifPad and ClifCode. This includes a new **Local Models** tab that intelligently recommends, downloads, and loads models based on the user's hardware, while prioritizing performance and reliability.

This moves Clif from being "just another agent tool" to a **privacy-first, high-performance local + hybrid coding agent platform**.

## 2. Problem / Opportunity

Current state:
- Users must manually set up Ollama or external backends.
- No hardware-aware recommendations.
- No easy way to discover good coding models.
- Local experience feels second-class compared to cloud options.

Opportunity:
- Growing demand for local/privacy-focused coding agents.
- Many developers want fast, reliable local inference without managing separate servers.
- We can differentiate by making local model selection simple, smart, and optimized for coding work (using SWE-bench signals).

## 3. Proposed Solution

**Two-part initiative:**

1. **Embed a high-performance Rust LLM runtime** directly into the app (remove or reduce dependency on external Ollama for local use).
2. **Add a new "Local Models" tab** in ClifPad that handles:
   - Hardware detection
   - Smart model recommendations (hardware + coding performance)
   - One-click download from Hugging Face
   - Model loading and switching

## 4. Technical Recommendations (Performance + Reliability Focused)

### 4.1 Inference engine — per-platform split (DECIDED)

llama.cpp is **not** the fastest runtime on Apple Silicon — **MLX is, by ~2–3×**
(e.g. ~130 tok/s vs ~43 tok/s for Qwen3-Coder-30B-A3B on an M4 Pro). But MLX is
Mac-only. There is no single engine that is both fastest-on-Mac and best
cross-platform, so we split by platform behind one backend interface:

| Platform        | Engine                              | Why |
|-----------------|-------------------------------------|-----|
| **macOS (primary)** | **MLX** via `mlx-rs` (in-process); study/fork **`mlxcel`** | Fastest on Apple Silicon; M5 has MLX-specific Neural Accelerators. `mlxcel` is a Rust-native MLX engine that already wires speculative decoding + prefix caching + KV compression in-process — strong prior art to build on. |
| **Windows / Linux** | **`llama-cpp-4`** (primary) or **`mistral.rs`** | `llama-cpp-4`: most mature, battle-tested in-process binding. `mistral.rs`: pure-Rust alternative (≈ llama.cpp on Metal, has built-in speculative decoding) if we want one Rust stack and to avoid the C++ dep. |

Both engines run **in-process inside the Clif binary** (no LM Studio / Ollama /
external server) and sit behind a single `ModelBackend` so the agent harness is
engine-agnostic.

### 4.2 Supporting crates

| Component              | Recommended Option       | Rationale |
|------------------------|--------------------------|-----------|
| **HF Integration**     | `hf-hub`                 | Official, reliable way to download GGUF / MLX-format models. |
| **Hardware Detection** | `sysinfo` + `syspeek`    | Reliable RAM + decent VRAM/GPU detection. |
| **Coding Benchmarks**  | SWE-bench public JSON    | Use real coding performance data for recommendations. |
| **Aux models (Rust, in-process)** | `candle`     | Pure-Rust niche: embeddings/reranker for the indexer, draft model for speculative decoding, router/classifier. Not the 30B hot path. |

**Primary stack**: MLX (`mlx-rs`/`mlxcel`) on Mac · `llama-cpp-4` / `mistral.rs`
on Win/Linux · `hf-hub` + `sysinfo` + `syspeek`.

### 4.3 Architecture invariants (DECIDED)

- **Embedded runner.** The engine runs inside the Clif binary. No external
  server dependency. (Saves the localhost-API hop, but the real wins are single-
  binary UX + direct KV-cache / speculative-decoding control.)
- **Harness stays single-model.** The agent harness always targets one
  `ModelBackend`. Local vs cloud (OpenRouter) is just a different backend. Local
  models reuse the same single-active-model path that OpenRouter uses today.
- **One active model in v1.** Users may download several models (disk only);
  exactly one is loaded/active at a time. OpenRouter remains the cloud fallback.
- **Performance moat is the orchestration layer, not custom kernels.**
  Speculative decoding (small draft + big model), prefix/KV caching, and
  context minimization (reuse `repomap.rs` + indexer) live inside the local
  engine — transparent to the harness. This is where "fastest local *coding*
  service" is actually won (target metric: time-to-first-useful-edit, not raw
  decode tok/s). Marked **Phase 2** below.

## 5. New Feature: Local Models Tab (ClifPad)

**Location**: New top-level tab in ClifPad (alongside Editor, Terminal, Agent, etc.).

**Core Capabilities**:

- **Hardware Detection**
  - Automatically detect RAM, CPU cores, and GPU + VRAM (best effort).
  - Show clear summary: "Detected: 32GB RAM + RTX 4070 (12GB VRAM)"

- **Smart Recommendations**
  - Show 4–6 recommended models filtered by detected hardware.
  - Prioritize models that perform well on coding tasks (pull from SWE-bench data where possible).
  - Show estimated fit: "Fits comfortably", "Good", "May be slow", "Too large".
  - Display key info: Size, Quantization, Approx. tokens/sec (if known), SWE-bench strength.

- **Model Browser**
  - Search or browse popular coding models from Hugging Face (Qwen-Coder, DeepSeek-Coder, Llama-3.1/3.2 variants, etc.).
  - Filter by size / quantization.

- **Download & Load**
  - One-click download (via `hf-hub`).
  - Progress indicator.
  - Option to load immediately after download.
  - Support for both local inference and keeping cloud providers as fallback.

- **Model Management**
  - List currently downloaded models.
  - Easy switch between local models.
  - Show which model is currently active.
  - Delete models.

**Optional but valuable**:
- Quick "Test this model" button (runs a small coding benchmark).
- Option to use cloud models alongside local ones.

## 6. User Flow (Simplified)

1. User opens **Local Models** tab.
2. App detects hardware and shows recommendations.
3. User picks a recommended model or browses others.
4. Clicks **Download**.
5. Model downloads → becomes available to use in Agent sidebar or TUI.
6. User can switch models anytime from the tab or a quick selector.

## 7. Non-Functional Requirements

- **Performance**: Local inference should feel responsive (target: minimize latency vs Ollama).
- **Reliability**: Use well-maintained crates (`llama-cpp-4` preferred).
- **Privacy**: All local inference happens on-device. No data sent unless user chooses cloud.
- **Size**: Keep app binary growth reasonable (llama.cpp adds weight — consider dynamic loading if possible).
- **Fallback**: Keep full support for OpenRouter / direct cloud providers.

## 8. Success Metrics

- % of users who download and use at least one local model within 7 days.
- Average time from opening Local Models tab to having a working local model.
- User feedback on recommendation quality (hardware fit + coding performance).
- Reduction in support questions about setting up local models.

## 9. Open Questions / Risks

**Resolved:**
- ~~Which runtime?~~ → MLX on Mac (primary), `llama-cpp-4` / `mistral.rs` on
  Win/Linux. Embedded in-process. (§4.1)
- ~~Single vs multiple models loaded?~~ → **Single active model in v1.** Harness
  stays single-model. Multi-resident is only ever for the optional speculative-
  decoding draft model (Phase 2) — still presented to the user as one model.
- ~~Embed vs external server (LM Studio/Ollama)?~~ → **Embed.** Single binary, no
  external dependency, direct cache control.

**Still open:**
- How aggressively do we push local vs keep cloud (OpenRouter) as primary?
- "Best coding performance" vs "Best speed" recommendation mode — offer both?
- Binary-size impact of bundling MLX + llama.cpp; consider dynamic/lazy loading
  of the engine so a cloud-only user doesn't pay for it.
- MLX-format vs GGUF weights: do we download both, or convert? (`hf-hub` covers
  both, but the catalog must track which format each engine needs.)

## 10. Phasing

- **Phase 1 (ship first):** embedded single runner per platform, Local Models tab
  (hardware detect → recommend → download → load), one active local model,
  OpenRouter cloud fallback. No speculative decoding, no multi-model.
- **Phase 2 (optional, non-breaking speedups):** speculative decoding (Candle
  draft model + main model), prefix/KV caching, context minimization via the
  existing indexer/repomap. Optional per-task model routing. All invisible to the
  harness contract.
