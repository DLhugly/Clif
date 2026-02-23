use std::process::Command;

#[derive(serde::Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(serde::Serialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
}

/// Parse a git status porcelain line into a GitFileStatus
fn parse_status_line(line: &str) -> Option<GitFileStatus> {
    if line.len() < 4 {
        return None;
    }

    let index_status = line.chars().nth(0)?;
    let worktree_status = line.chars().nth(1)?;
    let file_path = line[3..].to_string();

    let (status, staged) = match (index_status, worktree_status) {
        ('?', '?') => ("untracked".to_string(), false),
        ('A', _) => ("added".to_string(), true),
        ('M', ' ') => ("modified".to_string(), true),
        (' ', 'M') => ("modified".to_string(), false),
        ('M', 'M') => ("modified".to_string(), true),
        ('D', _) => ("deleted".to_string(), true),
        (' ', 'D') => ("deleted".to_string(), false),
        ('R', _) => ("renamed".to_string(), true),
        ('C', _) => ("copied".to_string(), true),
        ('U', _) | (_, 'U') => ("unmerged".to_string(), false),
        ('!', '!') => ("ignored".to_string(), false),
        _ => ("unknown".to_string(), false),
    };

    Some(GitFileStatus {
        path: file_path,
        status,
        staged,
    })
}

#[tauri::command]
pub fn git_status(path: String) -> Result<Vec<GitFileStatus>, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let statuses: Vec<GitFileStatus> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| parse_status_line(line))
        .collect();

    Ok(statuses)
}

#[tauri::command]
pub fn git_diff(path: String, file: Option<String>) -> Result<String, String> {
    let mut args = vec!["diff".to_string()];

    if let Some(ref file_path) = file {
        args.push("--".to_string());
        args.push(file_path.clone());
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    // Stage all changes
    let add_output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // Commit
    let commit_output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&commit_output.stdout).to_string();
    Ok(stdout)
}

#[tauri::command]
pub fn git_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let output = Command::new("git")
        .args(["branch", "--list"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git branch: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git branch failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let branches: Vec<GitBranch> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let is_current = line.starts_with('*');
            let name = line
                .trim_start_matches('*')
                .trim()
                .to_string();
            GitBranch { name, is_current }
        })
        .collect();

    Ok(branches)
}

#[tauri::command]
pub fn git_checkout(path: String, branch: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["checkout", &branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git checkout failed: {}", stderr));
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct GitDiffStat {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

#[tauri::command]
pub fn git_diff_stat(path: String) -> Result<GitDiffStat, String> {
    // Unstaged changes
    let unstaged = Command::new("git")
        .args(["diff", "--shortstat"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    // Staged changes
    let staged = Command::new("git")
        .args(["diff", "--cached", "--shortstat"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;

    let mut files_changed = 0usize;
    let mut insertions = 0usize;
    let mut deletions = 0usize;

    for output in [&unstaged, &staged] {
        let text = String::from_utf8_lossy(&output.stdout);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        // Parse: " 3 files changed, 10 insertions(+), 2 deletions(-)"
        for part in text.split(',') {
            let part = part.trim();
            if let Some(num_str) = part.split_whitespace().next() {
                if let Ok(num) = num_str.parse::<usize>() {
                    if part.contains("file") {
                        files_changed += num;
                    } else if part.contains("insertion") {
                        insertions += num;
                    } else if part.contains("deletion") {
                        deletions += num;
                    }
                }
            }
        }
    }

    Ok(GitDiffStat {
        files_changed,
        insertions,
        deletions,
    })
}

#[tauri::command]
pub fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(files);

    let output = Command::new("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git reset: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git reset failed: {}", stderr));
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
    pub is_head: bool,
    pub parents: Vec<String>,
}

#[tauri::command]
pub fn git_log(path: String, count: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    let n = count.unwrap_or(50);
    let output = Command::new("git")
        .args([
            "log",
            "--all",
            &format!("--max-count={}", n),
            "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ar\x1f%D\x1f%P",
        ])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<GitLogEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\x1f').collect();
            let refs_str = parts.get(5).unwrap_or(&"");
            let refs: Vec<String> = if refs_str.is_empty() {
                vec![]
            } else {
                refs_str.split(", ").map(|s| s.trim().to_string()).collect()
            };
            let is_head = refs.iter().any(|r| r.contains("HEAD"));
            let parents_str = parts.get(6).unwrap_or(&"");
            let parents: Vec<String> = if parents_str.is_empty() {
                vec![]
            } else {
                parents_str.split(' ').map(|s| s.to_string()).collect()
            };

            GitLogEntry {
                hash: parts.first().unwrap_or(&"").to_string(),
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                message: parts.get(2).unwrap_or(&"").to_string(),
                author: parts.get(3).unwrap_or(&"").to_string(),
                date: parts.get(4).unwrap_or(&"").to_string(),
                refs,
                is_head,
                parents,
            }
        })
        .collect();

    Ok(entries)
}

#[derive(serde::Serialize)]
pub struct GitFileNumstat {
    pub path: String,
    pub insertions: i64,
    pub deletions: i64,
}

#[tauri::command]
pub fn git_diff_numstat(path: String) -> Result<Vec<GitFileNumstat>, String> {
    let mut stats: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();

    // Unstaged changes
    let unstaged = Command::new("git")
        .args(["diff", "--numstat"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff --numstat: {}", e))?;

    if unstaged.status.success() {
        let stdout = String::from_utf8_lossy(&unstaged.stdout);
        for line in stdout.lines() {
            if let Some(stat) = parse_numstat_line(line) {
                let entry = stats.entry(stat.path.clone()).or_insert((0, 0));
                entry.0 += stat.insertions;
                entry.1 += stat.deletions;
            }
        }
    }

    // Staged changes
    let staged = Command::new("git")
        .args(["diff", "--cached", "--numstat"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git diff --cached --numstat: {}", e))?;

    if staged.status.success() {
        let stdout = String::from_utf8_lossy(&staged.stdout);
        for line in stdout.lines() {
            if let Some(stat) = parse_numstat_line(line) {
                let entry = stats.entry(stat.path.clone()).or_insert((0, 0));
                entry.0 += stat.insertions;
                entry.1 += stat.deletions;
            }
        }
    }

    let result: Vec<GitFileNumstat> = stats
        .into_iter()
        .map(|(path, (ins, del))| GitFileNumstat {
            path,
            insertions: ins,
            deletions: del,
        })
        .collect();

    Ok(result)
}

fn parse_numstat_line(line: &str) -> Option<GitFileNumstat> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 3 {
        return None;
    }
    // Binary files show "-" for insertions/deletions
    let insertions = parts[0].parse::<i64>().unwrap_or(-1);
    let deletions = parts[1].parse::<i64>().unwrap_or(-1);
    let path = parts[2].to_string();
    Some(GitFileNumstat {
        path,
        insertions,
        deletions,
    })
}

#[tauri::command]
pub fn git_init(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["init"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git init: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git init failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

#[tauri::command]
pub fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["add".to_string()];
    args.extend(files);

    let output = Command::new("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    Ok(())
}
