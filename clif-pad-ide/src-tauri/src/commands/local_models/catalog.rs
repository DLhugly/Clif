//! Curated catalog of coding-focused local models + hardware-fit scoring.
//!
//! v1 ships GGUF weights (universal; works with the llama.cpp fallback engine and
//! is concrete to download via HTTP). MLX-format variants are a follow-up tied to
//! the MLX engine — see PRD §4.1 / §9. Repo + filename are the integration point;
//! a wrong filename simply 404s at download time and surfaces in the UI.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    /// Hugging Face repo holding the GGUF, e.g. "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF".
    pub hf_repo: String,
    /// GGUF filename within the repo.
    pub file: String,
    pub params_b: f64,
    /// Approx on-disk size of the weight file in GB.
    pub size_gb: f64,
    pub quant: String,
    /// Minimum total system RAM (GB) we'd recommend for this model.
    pub min_ram_gb: f64,
    pub context: u32,
    /// "reasoning" | "agentic" | "autocomplete" | "general"
    pub role: String,
    pub swe_note: String,
}

/// Fit verdict for a model against detected RAM.
#[derive(Serialize, Clone)]
pub struct CatalogEntry {
    #[serde(flatten)]
    pub model: CatalogModel,
    /// "comfortable" | "good" | "slow" | "too_large"
    pub fit: String,
    pub fit_label: String,
    pub downloaded: bool,
    pub active: bool,
}

fn m(
    id: &str,
    name: &str,
    repo: &str,
    file: &str,
    params_b: f64,
    size_gb: f64,
    quant: &str,
    min_ram_gb: f64,
    context: u32,
    role: &str,
    swe_note: &str,
) -> CatalogModel {
    CatalogModel {
        id: id.into(),
        name: name.into(),
        hf_repo: repo.into(),
        file: file.into(),
        params_b,
        size_gb,
        quant: quant.into(),
        min_ram_gb,
        context,
        role: role.into(),
        swe_note: swe_note.into(),
    }
}

/// The curated set. Ordered roughly by capability; the UI re-sorts by fit.
pub fn all() -> Vec<CatalogModel> {
    vec![
        m(
            "qwen3-coder-30b-a3b",
            "Qwen3-Coder 30B-A3B (MoE)",
            "Qwen/Qwen3-Coder-30B-A3B-Instruct-GGUF",
            "qwen3-coder-30b-a3b-instruct-q4_k_m.gguf",
            30.0, 17.0, "Q4_K_M", 24.0, 32768,
            "agentic",
            "Default Mac coding model — 30B memory, ~3B active. Fast + strong.",
        ),
        m(
            "devstral-small-2",
            "Devstral Small 2 (24B)",
            "mistralai/Devstral-Small-2-GGUF",
            "devstral-small-2-q4_k_m.gguf",
            24.0, 14.0, "Q4_K_M", 24.0, 32768,
            "agentic",
            "Mistral's agentic coding model. ~68% SWE-bench Verified.",
        ),
        m(
            "qwen2.5-coder-32b",
            "Qwen2.5-Coder 32B",
            "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
            "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
            32.0, 19.0, "Q4_K_M", 32.0, 32768,
            "reasoning",
            "Heavy dense reasoning; rivals frontier-cloud on many coding tasks.",
        ),
        m(
            "qwen2.5-coder-14b",
            "Qwen2.5-Coder 14B",
            "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
            "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
            14.0, 9.0, "Q4_K_M", 16.0, 32768,
            "general",
            "Strong mid-tier; good balance of quality and footprint.",
        ),
        m(
            "qwen2.5-coder-7b",
            "Qwen2.5-Coder 7B",
            "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
            "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
            7.0, 4.5, "Q4_K_M", 16.0, 32768,
            "general",
            "Runs almost anywhere; solid general coding for its size.",
        ),
        m(
            "qwen2.5-coder-3b",
            "Qwen2.5-Coder 3B",
            "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
            "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
            3.0, 2.0, "Q4_K_M", 8.0, 32768,
            "autocomplete",
            "Tiny + fast — best for fill-in-middle / autocomplete.",
        ),
    ]
}

pub fn find(id: &str) -> Option<CatalogModel> {
    all().into_iter().find(|m| m.id == id)
}

/// Compute a fit verdict from the model's working-set vs. detected RAM.
///
/// We budget ~70% of total RAM for inference (leave headroom for the OS + app),
/// and pad the weight size by ~1.25x to approximate KV cache + runtime overhead.
pub fn fit_for(size_gb: f64, total_ram_gb: f64) -> (&'static str, &'static str) {
    let budget = total_ram_gb * 0.70;
    let required = size_gb * 1.25;

    if required <= budget * 0.60 {
        ("comfortable", "Fits comfortably")
    } else if required <= budget * 0.85 {
        ("good", "Good")
    } else if required <= budget {
        ("slow", "May be slow")
    } else {
        ("too_large", "Too large")
    }
}
