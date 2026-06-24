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
