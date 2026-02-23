use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub file: String,
    pub line: u32,
    pub content: String,
    pub match_start: u32,
    pub match_end: u32,
}

/// Directories to skip during search
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "build",
    "out",
];

/// Binary/large file extensions to skip
const SKIP_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg", "webp", "mp3", "mp4", "avi", "mov", "mkv",
    "zip", "tar", "gz", "rar", "7z", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "exe",
    "dll", "so", "dylib", "wasm", "ttf", "otf", "woff", "woff2", "eot", "lock", "bin",
];

#[tauri::command]
pub fn search_files(
    path: String,
    query: String,
    file_pattern: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let root = Path::new(&path);

    if !root.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();
    let max_results = 500; // Limit results to prevent overwhelming the frontend

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip hidden directories and known large directories
            let file_name = e.file_name().to_string_lossy();
            if file_name.starts_with('.') && e.depth() > 0 {
                return false;
            }
            if e.file_type().is_dir() && SKIP_DIRS.contains(&file_name.as_ref()) {
                return false;
            }
            true
        })
    {
        if results.len() >= max_results {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let entry_path = entry.path();

        // Check file extension against skip list
        if let Some(ext) = entry_path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if SKIP_EXTENSIONS.contains(&ext_str.as_str()) {
                continue;
            }
        }

        // Apply file pattern filter if provided
        if let Some(ref pattern) = file_pattern {
            let file_name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if !simple_glob_match(pattern, &file_name) {
                continue;
            }
        }

        // Read file and search for matches
        let content = match fs::read_to_string(entry_path) {
            Ok(c) => c,
            Err(_) => continue, // Skip files that can't be read as UTF-8
        };

        let file_path_str = entry_path.to_string_lossy().to_string();

        for (line_num, line) in content.lines().enumerate() {
            if results.len() >= max_results {
                break;
            }

            let line_lower = line.to_lowercase();
            if let Some(pos) = line_lower.find(&query_lower) {
                results.push(SearchResult {
                    file: file_path_str.clone(),
                    line: (line_num + 1) as u32,
                    content: line.to_string(),
                    match_start: pos as u32,
                    match_end: (pos + query.len()) as u32,
                });
            }
        }
    }

    Ok(results)
}

/// Simple glob matching supporting * and ? wildcards
fn simple_glob_match(pattern: &str, text: &str) -> bool {
    let pattern_lower = pattern.to_lowercase();
    let text_lower = text.to_lowercase();

    let pattern_chars: Vec<char> = pattern_lower.chars().collect();
    let text_chars: Vec<char> = text_lower.chars().collect();

    glob_match_recursive(&pattern_chars, &text_chars, 0, 0)
}

fn glob_match_recursive(pattern: &[char], text: &[char], pi: usize, ti: usize) -> bool {
    if pi == pattern.len() && ti == text.len() {
        return true;
    }

    if pi == pattern.len() {
        return false;
    }

    if pattern[pi] == '*' {
        // Try matching * with zero or more characters
        for i in ti..=text.len() {
            if glob_match_recursive(pattern, text, pi + 1, i) {
                return true;
            }
        }
        return false;
    }

    if ti == text.len() {
        return false;
    }

    if pattern[pi] == '?' || pattern[pi] == text[ti] {
        return glob_match_recursive(pattern, text, pi + 1, ti + 1);
    }

    false
}
