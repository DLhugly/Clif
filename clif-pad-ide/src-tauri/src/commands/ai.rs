use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

#[derive(serde::Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Optional base64 data URLs for image attachments (vision models)
    pub images: Option<Vec<String>>,
    /// OpenAI-format tool calls attached to an assistant turn. When set, the
    /// agent loop preserves them as `assistant.tool_calls` so the model
    /// sees its own previous tool invocations on follow-up user turns.
    /// Each entry is the raw `{ id, type: "function", function: { name,
    /// arguments } }` object so providers can pass it straight through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    /// When `role == "tool"`, the id of the originating assistant tool call.
    /// Required for OpenAI/Anthropic to match results back to invocations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Optional tool name on a `role: "tool"` message. Some providers want
    /// it; harmless for the rest because we skip-serialize when None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
}

/// Get the path to the API keys storage file
fn get_keys_file_path() -> Result<PathBuf, String> {
    let home = dirs_next().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_dir = home.join(".clif");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir.join("api_keys.json"))
}

/// Helper to get the home directory cross-platform
fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Get the base URL for a given provider
fn get_provider_url(provider: &str) -> String {
    match provider {
        "ollama" => "http://localhost:11434/v1/chat/completions".to_string(),
        "openrouter" | _ => "https://openrouter.ai/api/v1/chat/completions".to_string(),
    }
}

#[tauri::command]
pub async fn ai_chat(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    model: String,
    api_key: Option<String>,
    provider: String,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let url = get_provider_url(&provider);

    // Build the messages array for the API
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let mut request_body = json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
    });

    // For OpenRouter, add extra headers via the body if needed
    if provider == "openrouter" {
        if let Some(obj) = request_body.as_object_mut() {
            obj.insert(
                "transforms".to_string(),
                json!(["middle-out"]),
            );
        }
    }

    let client = reqwest::Client::new();
    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json");

    // Add authorization header if API key is provided
    if let Some(ref key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    // Add OpenRouter-specific headers
    if provider == "openrouter" {
        req_builder = req_builder
            .header("HTTP-Referer", "https://clif.dev")
            .header("X-Title", "Clif");
    }

    // Spawn the streaming task so we don't block the command
    tokio::spawn(async move {
        let response = match req_builder.json(&request_body).send().await {
            Ok(resp) => resp,
            Err(e) => {
                let _ = app.emit_to(&label, "ai_stream_error", format!("Request failed: {}", e));
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let _ = app.emit_to(
                &label,
                "ai_stream_error",
                format!("API error {}: {}", status, body),
            );
            return;
        }

        // Read the streaming response
        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    eprintln!("AI Review - Raw chunk: {} bytes", chunk_str.len());
                    buffer.push_str(&chunk_str);

                    // Process complete SSE lines from the buffer
                    while let Some(newline_pos) = buffer.find('\n') {
                        let line = buffer[..newline_pos].trim().to_string();
                        buffer = buffer[newline_pos + 1..].to_string();

                        if line.is_empty() {
                            continue;
                        }

                        if line.starts_with("data: ") {
                            let data = &line[6..];

                            if data == "[DONE]" {
                                let _ = app.emit_to(&label, "ai_stream", "[DONE]");
                                return;
                            }

                            // Parse the JSON chunk
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(data)
                            {
                                // Extract delta content from the streaming response
                                if let Some(choices) = parsed.get("choices") {
                                    if let Some(first_choice) = choices.get(0) {
                                        if let Some(delta) = first_choice.get("delta") {
                                            if let Some(content) =
                                                delta.get("content").and_then(|c| c.as_str())
                                            {
                                                let _ = app.emit_to(&label, "ai_stream", content);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit_to(
                        &label,
                        "ai_stream_error",
                        format!("Stream read error: {}", e),
                    );
                    return;
                }
            }
        }

        // If we get here without a [DONE], still signal completion
        let _ = app.emit_to(&label, "ai_stream", "[DONE]");
    });

    Ok(())
}

#[tauri::command]
pub async fn ai_complete(
    context: String,
    model: String,
    api_key: Option<String>,
    provider: String,
) -> Result<String, String> {
    let url = get_provider_url(&provider);

    let request_body = json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a code completion assistant. The user provides code with <|fim_prefix|> before the cursor and <|fim_suffix|> after. Output ONLY the code to insert at the cursor. No explanations, no markdown, no fences."
            },
            {
                "role": "user",
                "content": context
            }
        ],
        "max_tokens": 256,
        "temperature": 0.2,
        "stream": false,
    });

    let client = reqwest::Client::new();
    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    if provider == "openrouter" {
        req_builder = req_builder
            .header("HTTP-Referer", "https://clif.dev")
            .header("X-Title", "Clif");
    }

    let response = req_builder
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let completion = body
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    Ok(completion)
}

#[tauri::command]
pub async fn get_models(
    provider: String,
    api_key: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let client = reqwest::Client::new();

    match provider.as_str() {
        "openrouter" | _ => {
            // Fetch from OpenRouter API
            let mut req_builder = client.get("https://openrouter.ai/api/v1/models");

            if let Some(ref key) = api_key {
                req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
            }

            let response = req_builder
                .send()
                .await
                .map_err(|e| format!("Failed to fetch models: {}", e))?;

            if !response.status().is_success() {
                return Err("Failed to fetch OpenRouter models".to_string());
            }

            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            let models = body
                .get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            Some(ModelInfo {
                                id,
                                name,
                                provider: "openrouter".to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok(models)
        }
    }
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let keys_path = get_keys_file_path()?;

    // Read existing keys or create new object
    let mut keys: serde_json::Value = if keys_path.exists() {
        let content =
            fs::read_to_string(&keys_path).map_err(|e| format!("Failed to read keys file: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    // Set the key for the provider
    if let Some(obj) = keys.as_object_mut() {
        obj.insert(provider, json!(key));
    }

    // Write back
    let content =
        serde_json::to_string_pretty(&keys).map_err(|e| format!("Failed to serialize keys: {}", e))?;
    fs::write(&keys_path, content).map_err(|e| format!("Failed to write keys file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_api_key(provider: String) -> Result<Option<String>, String> {
    let keys_path = get_keys_file_path()?;

    if !keys_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&keys_path).map_err(|e| format!("Failed to read keys file: {}", e))?;
    let keys: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse keys file: {}", e))?;

    let key = keys
        .get(&provider)
        .and_then(|k| k.as_str())
        .map(|s| s.to_string());

    Ok(key)
}

#[tauri::command]
pub async fn generate_commit_message(
    diff: String,
    staged_files: Vec<String>,
    model: String,
    api_key: Option<String>,
    provider: String,
) -> Result<String, String> {
    let url = get_provider_url(&provider);

    let files_list = staged_files.join(", ");
    let prompt = format!(
        r#"Generate a concise, conventional commit message for these staged changes.

Files changed: {}

Diff:
{}

Rules:
- Use conventional commit format (feat:, fix:, chore:, docs:, refactor:, etc.)
- Keep it under 72 characters
- Be specific but concise
- Don't include the backticks or quotes, just the message

Respond with ONLY the commit message, nothing else."#,
        files_list, diff
    );

    let api_messages = vec![json!({
        "role": "user",
        "content": prompt,
    })];

    let mut request_body = json!({
        "model": model,
        "messages": api_messages,
        "stream": false,
        "max_tokens": 100,
    });

    if provider == "openrouter" {
        if let Some(obj) = request_body.as_object_mut() {
            obj.insert(
                "transforms".to_string(),
                json!(["middle-out"]),
            );
        }
    }

    let client = reqwest::Client::new();
    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = api_key {
        if provider == "openrouter" {
            req_builder = req_builder
                .header("Authorization", format!("Bearer {}", key))
                .header("HTTP-Referer", "https://clifcode.io")
                .header("X-Title", "ClifPad");
        } else {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
        }
    }

    let response = req_builder
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("chore: update files")
        .trim()
        .to_string();

    Ok(content)
}

#[derive(serde::Serialize, Clone)]
pub struct CodeReviewSuggestion {
    pub file: String,
    pub line: Option<usize>,
    pub severity: String, // "warning" | "info" | "suggestion"
    pub title: String,
    pub description: String,
    pub suggestion: Option<String>,
}

#[derive(serde::Serialize)]
pub struct CodeReviewResult {
    pub files_scanned: Vec<String>,
    pub suggestions: Vec<CodeReviewSuggestion>,
    pub summary: String,
}

#[tauri::command]
pub async fn ai_review_code(
    window: tauri::Window,
    diff: String,
    staged_files: Vec<String>,
    model: String,
    api_key: Option<String>,
    provider: String,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let url = get_provider_url(&provider);

    // Truncate diff if too long for faster processing
    let truncated_diff = if diff.len() > 6000 {
        format!("{}...\n[Truncated]", &diff[..6000])
    } else {
        diff.clone()
    };
    
    let files_list = staged_files.join(", ");
    // Shorter, faster prompt
    let prompt = format!(
        r#"Quick review of: {}

{}

List issues in this format:
**file:line** (severity): description

Only real issues. Be brief."#,
        files_list, truncated_diff
    );

    let api_messages = vec![json!({
        "role": "user",
        "content": prompt,
    })];

    let mut request_body = json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
        "max_tokens": 500,
    });

    if provider == "openrouter" {
        if let Some(obj) = request_body.as_object_mut() {
            obj.insert(
                "transforms".to_string(),
                json!(["middle-out"]),
            );
        }
    }

    let client = reqwest::Client::new();
    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = api_key {
        if provider == "openrouter" {
            req_builder = req_builder
                .header("Authorization", format!("Bearer {}", key))
                .header("HTTP-Referer", "https://clifcode.io")
                .header("X-Title", "ClifPad");
        } else {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
        }
    }

    // Spawn streaming task
    tokio::spawn(async move {
        let response = match req_builder.json(&request_body).send().await {
            Ok(resp) => resp,
            Err(e) => {
                let _ = app.emit_to(&label, "code_review_error", format!("Request failed: {}", e));
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let _ = app.emit_to(&label, "code_review_error", format!("API error {}: {}", status, body));
            return;
        }

        // Emit start event with files being scanned
        let _ = app.emit_to(&label, "code_review_start", staged_files.clone());

        // Stream the response
        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = String::new();
        let mut full_content = String::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    eprintln!("AI Review - Raw chunk received: {} bytes", chunk_str.len());
                    buffer.push_str(&chunk_str);

                    while let Some(newline_pos) = buffer.find('\n') {
                        let line = buffer[..newline_pos].trim().to_string();
                        buffer = buffer[newline_pos + 1..].to_string();

                        if line.is_empty() || !line.starts_with("data: ") {
                            continue;
                        }

                        let data = &line[6..];

                        if data == "[DONE]" {
                            let _ = app.emit_to(&label, "code_review_done", &full_content);
                            return;
                        }

                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            // Log the parsed structure for debugging
                            eprintln!("Parsed JSON: {}", serde_json::to_string(&parsed).unwrap_or_default());
                            
                            // Check for content in both "content" and "reasoning" fields
                            // Some models (like GLM, DeepSeek) use "reasoning" instead of "content"
                            let content = parsed["choices"][0]["delta"]["content"].as_str()
                                .filter(|s| !s.is_empty())
                                .or_else(|| parsed["choices"][0]["delta"]["reasoning"].as_str())
                                .unwrap_or("");
                            
                            if !content.is_empty() {
                                eprintln!("Code review stream content: {} bytes", content.len());
                                full_content.push_str(content);
                                let _ = app.emit_to(&label, "code_review_stream", content);
                            }
                        } else {
                            // Log parsing failures for debugging
                            eprintln!("Failed to parse SSE data: {}", data);
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit_to(&label, "code_review_error", format!("Stream error: {}", e));
                    return;
                }
            }
        }

        let _ = app.emit_to(&label, "code_review_done", &full_content);
    });

    Ok(())
}
