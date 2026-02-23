import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileEntry } from "../types/files";
import type { ChatMessage, ModelInfo } from "../types/ai";
import type { GitFileStatus, GitBranch, GitLogEntry, GitFileNumstat } from "../types/git";

// File system commands
export async function readDir(path: string): Promise<FileEntry[]> {
  return invoke("read_dir", { path });
}

export async function readFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", { path, content });
}

export async function createFile(path: string): Promise<void> {
  return invoke("create_file", { path });
}

export async function createDir(path: string): Promise<void> {
  return invoke("create_dir", { path });
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke("rename_entry", { oldPath, newPath });
}

export async function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}

export async function watchDir(path: string): Promise<void> {
  return invoke("watch_dir", { path });
}

// AI commands
export async function aiChat(
  messages: { role: string; content: string }[],
  model: string,
  apiKey: string | null,
  provider: string
): Promise<void> {
  return invoke("ai_chat", { messages, model, apiKey, provider });
}

export async function aiComplete(
  context: string,
  model: string,
  apiKey: string | null,
  provider: string
): Promise<string> {
  return invoke("ai_complete", { context, model, apiKey, provider });
}

export async function getModels(
  provider: string,
  apiKey: string | null
): Promise<ModelInfo[]> {
  return invoke("get_models", { provider, apiKey });
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  return invoke("set_api_key", { provider, key });
}

export async function getApiKey(provider: string): Promise<string | null> {
  return invoke("get_api_key", { provider });
}

// Git commands
export async function gitStatus(path: string): Promise<GitFileStatus[]> {
  return invoke("git_status", { path });
}

export async function gitDiff(path: string, file?: string): Promise<string> {
  return invoke("git_diff", { path, file: file ?? null });
}

export async function gitCommit(path: string, message: string): Promise<string> {
  return invoke("git_commit", { path, message });
}

export async function gitBranches(path: string): Promise<GitBranch[]> {
  return invoke("git_branches", { path });
}

export async function gitCheckout(path: string, branch: string): Promise<void> {
  return invoke("git_checkout", { path, branch });
}

export async function gitStage(path: string, files: string[]): Promise<void> {
  return invoke("git_stage", { path, files });
}

export async function gitUnstage(path: string, files: string[]): Promise<void> {
  return invoke("git_unstage", { path, files });
}

export async function gitDiffStat(path: string): Promise<{ files_changed: number; insertions: number; deletions: number }> {
  return invoke("git_diff_stat", { path });
}

export async function gitDiffNumstat(path: string): Promise<GitFileNumstat[]> {
  return invoke("git_diff_numstat", { path });
}

export async function gitInit(path: string): Promise<string> {
  return invoke("git_init", { path });
}

export async function gitLog(path: string, count?: number): Promise<GitLogEntry[]> {
  return invoke("git_log", { path, count: count ?? null });
}

// Search
export async function searchFiles(
  path: string,
  query: string,
  filePattern?: string
): Promise<{ file: string; line: number; content: string; match_start: number; match_end: number }[]> {
  return invoke("search_files", { path, query, filePattern: filePattern ?? null });
}

// Claude Code
export async function claudeCodeStart(task: string, workingDir: string): Promise<string> {
  return invoke("claude_code_start", { task, workingDir });
}

export async function claudeCodeSend(sessionId: string, input: string): Promise<void> {
  return invoke("claude_code_send", { sessionId, input });
}

export async function claudeCodeStop(sessionId: string): Promise<void> {
  return invoke("claude_code_stop", { sessionId });
}

// Settings
export async function getSettings(): Promise<Record<string, unknown>> {
  return invoke("get_settings");
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
  return invoke("set_settings", { settings });
}

// PTY commands
export async function ptySpawn(workingDir?: string): Promise<string> {
  return invoke("pty_spawn", { workingDir: workingDir ?? null });
}

export async function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke("pty_write", { sessionId, data });
}

export async function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { sessionId, cols, rows });
}

export async function ptyKill(sessionId: string): Promise<void> {
  return invoke("pty_kill", { sessionId });
}

// Event listeners
export function onAiStream(callback: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>("ai_stream", (event) => callback(event.payload));
}

export function onClaudeCodeOutput(
  callback: (data: { session_id: string; event_type: string; data: string }) => void
): Promise<UnlistenFn> {
  return listen("claude-code-output", (event) => callback(event.payload as any));
}

export function onPtyOutput(
  callback: (data: { session_id: string; data: string }) => void
): Promise<UnlistenFn> {
  return listen("pty-output", (event) => callback(event.payload as any));
}

export function onPtyExit(
  callback: (data: { session_id: string }) => void
): Promise<UnlistenFn> {
  return listen("pty-exit", (event) => callback(event.payload as any));
}

export function onFileChanged(
  callback: (data: { path: string; kind: string }) => void
): Promise<UnlistenFn> {
  return listen("file-changed", (event) => callback(event.payload as any));
}
