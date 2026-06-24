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

| Component              | Recommended Option       | Rationale |
|------------------------|--------------------------|-----------|
| **LLM Inference**      | `llama-cpp-4` (primary)  | Best performance + reliability balance. Close to upstream llama.cpp. |
| **Alternative**        | `mistralrs`              | Pure Rust option if we want to avoid C++ dependency long-term. |
| **HF Integration**     | `hf-hub`                 | Official, reliable way to download GGUF models. |
| **Hardware Detection** | `sysinfo` + `syspeek`    | Reliable RAM + decent VRAM/GPU detection. |
| **Coding Benchmarks**  | SWE-bench public JSON    | Use real coding performance data for recommendations. |

**Primary stack**: `llama-cpp-4` + `hf-hub` + `sysinfo` + `syspeek`.

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

- How aggressively do we want to push local vs keep cloud as primary?
- Do we support multiple local models loaded at once (complex) or single active model?
- Should we offer a "Best coding performance" vs "Best speed" recommendation mode?
- Binary size impact of embedding `llama-cpp-4`?
