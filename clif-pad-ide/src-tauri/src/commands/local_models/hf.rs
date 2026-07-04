//! Hugging Face Hub API client (public REST API — no `hf-hub` crate needed).
//!
//! We never hardcode/guess weight filenames. Instead we query the repo's file
//! tree, filter for GGUF, and resolve the file matching the desired quant. Sizes
//! come from the API (LFS size), so download progress and fit are accurate.
//!
//! Auth: an optional token (param, or `HF_TOKEN` env) is sent as a bearer header
//! — needed for gated repos (some Llama/Mistral) and higher rate limits.

use serde::{Deserialize, Serialize};

const API: &str = "https://huggingface.co/api";
const UA: &str = "ClifPad-LocalModels/1.0";

#[derive(Deserialize)]
struct TreeItem {
    #[serde(rename = "type")]
    kind: String,
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    lfs: Option<Lfs>,
}

#[derive(Deserialize)]
struct Lfs {
    #[serde(default)]
    size: u64,
}

#[derive(Serialize, Clone)]
pub struct HfFile {
    pub filename: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct HfVariant {
    pub filename: String,
    /// Parsed quant label, e.g. "Q4_K_M" (best-effort from the filename).
    pub quant: String,
    pub size_bytes: u64,
}

#[derive(Deserialize)]
struct ModelInfoResp {
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    gated: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct HfModelInfo {
    pub downloads: u64,
    pub likes: u64,
    pub gated: bool,
}

#[derive(Deserialize)]
struct SearchItem {
    id: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
}

#[derive(Serialize, Clone)]
pub struct HfModelSummary {
    pub id: String,
    pub downloads: u64,
    pub likes: u64,
}

fn token_value(token: &Option<String>) -> Option<String> {
    token
        .clone()
        .or_else(|| std::env::var("HF_TOKEN").ok())
        .filter(|t| !t.is_empty())
}

fn with_auth(req: reqwest::RequestBuilder, token: &Option<String>) -> reqwest::RequestBuilder {
    let req = req.header("User-Agent", UA);
    match token_value(token) {
        Some(t) => req.bearer_auth(t),
        None => req,
    }
}

/// Public download URL for a resolved file (LFS-aware via the `resolve` route).
pub fn resolve_url(repo: &str, filename: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo.trim_matches('/'),
        filename
    )
}

/// List every GGUF file in a repo with its real (LFS) size.
pub async fn list_gguf_files(repo: &str, token: &Option<String>) -> Result<Vec<HfFile>, String> {
    let url = format!(
        "{API}/models/{}/tree/main?recursive=true&expand=true",
        repo.trim_matches('/')
    );
    let client = reqwest::Client::new();
    let resp = with_auth(client.get(&url), token)
        .send()
        .await
        .map_err(|e| format!("HF request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Hugging Face API returned HTTP {} for repo '{}'",
            resp.status(),
            repo
        ));
    }

    let items: Vec<TreeItem> = resp
        .json()
        .await
        .map_err(|e| format!("parse HF tree: {e}"))?;

    let mut files: Vec<HfFile> = items
        .into_iter()
        .filter(|i| i.kind == "file" && i.path.to_lowercase().ends_with(".gguf"))
        .map(|i| {
            // LFS size is authoritative; plain `size` is the pointer otherwise.
            let size = i
                .lfs
                .as_ref()
                .map(|l| l.size)
                .filter(|s| *s > 0)
                .unwrap_or(i.size);
            HfFile {
                filename: i.path,
                size_bytes: size,
            }
        })
        .collect();

    files.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(files)
}

/// Parse a quant label out of a GGUF filename, e.g. "…-q4_k_m.gguf" -> "Q4_K_M".
pub fn parse_quant(filename: &str) -> String {
    let lower = filename.to_lowercase();
    // Common GGUF quant tokens, longest-first so Q4_K_M beats Q4_K / Q4.
    const TOKENS: &[&str] = &[
        "iq1_s", "iq2_xxs", "iq2_xs", "iq2_s", "iq3_xxs", "iq3_s", "iq4_xs", "iq4_nl",
        "q2_k", "q3_k_s", "q3_k_m", "q3_k_l", "q4_k_s", "q4_k_m", "q5_k_s", "q5_k_m",
        "q4_0", "q4_1", "q5_0", "q5_1", "q6_k", "q8_0", "f16", "bf16", "f32",
    ];
    let mut best = "";
    for t in TOKENS {
        if lower.contains(t) && t.len() > best.len() {
            best = t;
        }
    }
    if best.is_empty() {
        "GGUF".to_string()
    } else {
        best.to_uppercase()
    }
}

/// All GGUF variants in a repo (single-file only), each with parsed quant + size.
pub async fn list_variants(repo: &str, token: &Option<String>) -> Result<Vec<HfVariant>, String> {
    let files = list_gguf_files(repo, token).await?;
    let mut variants: Vec<HfVariant> = files
        .into_iter()
        // Skip sharded multi-part GGUF for v1.
        .filter(|f| !f.filename.to_lowercase().contains("-of-"))
        .map(|f| HfVariant {
            quant: parse_quant(&f.filename),
            filename: f.filename,
            size_bytes: f.size_bytes,
        })
        .collect();
    // Smaller (more quantized) first.
    variants.sort_by_key(|v| v.size_bytes);
    Ok(variants)
}

/// Fetch popularity + gated status for a repo.
pub async fn model_info(repo: &str, token: &Option<String>) -> Result<HfModelInfo, String> {
    let url = format!("{API}/models/{}", repo.trim_matches('/'));
    let client = reqwest::Client::new();
    let resp = with_auth(client.get(&url), token)
        .send()
        .await
        .map_err(|e| format!("HF info request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HF info HTTP {} for '{}'", resp.status(), repo));
    }
    let info: ModelInfoResp = resp.json().await.map_err(|e| format!("parse HF info: {e}"))?;
    // `gated` is `false` or a string like "auto"/"manual".
    let gated = !matches!(info.gated, serde_json::Value::Bool(false) | serde_json::Value::Null);
    Ok(HfModelInfo {
        downloads: info.downloads,
        likes: info.likes,
        gated,
    })
}

/// Resolve the single GGUF file matching a quant preference (e.g. "Q4_K_M").
/// Falls back to the first GGUF if no quant match. Errors if the repo has none.
pub async fn resolve_gguf(
    repo: &str,
    quant_pref: &str,
    token: &Option<String>,
) -> Result<HfFile, String> {
    let files = list_gguf_files(repo, token).await?;
    if files.is_empty() {
        return Err(format!("no GGUF files found in '{repo}'"));
    }

    // Multi-part GGUF (sharded) is out of scope for v1 — prefer single-file.
    let q = quant_pref.to_lowercase();
    let single: Vec<&HfFile> = files
        .iter()
        .filter(|f| !f.filename.to_lowercase().contains("-of-"))
        .collect();
    let pool = if single.is_empty() {
        files.iter().collect::<Vec<_>>()
    } else {
        single
    };

    let chosen = pool
        .iter()
        .find(|f| f.filename.to_lowercase().contains(&q))
        .or_else(|| pool.first())
        .ok_or_else(|| format!("could not select a GGUF in '{repo}'"))?;

    Ok((*chosen).clone())
}

/// Search GGUF-tagged models on the Hub, most-downloaded first.
pub async fn search_models(
    query: &str,
    token: &Option<String>,
) -> Result<Vec<HfModelSummary>, String> {
    let client = reqwest::Client::new();
    let resp = with_auth(
        client.get(format!("{API}/models")).query(&[
            ("search", query),
            ("filter", "gguf"),
            ("sort", "downloads"),
            ("direction", "-1"),
            ("limit", "24"),
        ]),
        token,
    )
    .send()
    .await
    .map_err(|e| format!("HF search failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Hugging Face search returned HTTP {}", resp.status()));
    }

    let items: Vec<SearchItem> = resp
        .json()
        .await
        .map_err(|e| format!("parse HF search: {e}"))?;

    Ok(items
        .into_iter()
        .map(|i| HfModelSummary {
            id: i.id,
            downloads: i.downloads,
            likes: i.likes,
        })
        .collect())
}
