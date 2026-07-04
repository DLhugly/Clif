import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import type { FileEntry } from "../types/files";
import type { ChatMessage, ModelInfo } from "../types/ai";
import type { GitFileStatus, GitBranch, GitLogEntry, GitFileNumstat } from "../types/git";

// Shell commands
export async function openExternal(url: string): Promise<void> {
  await open(url);
}

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

export async function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

export async function pasteFile(targetDir: string, fileName: string, contents: number[]): Promise<string> {
  return invoke("paste_file", { targetDir, fileName, contents });
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

export async function generateCommitMessage(
  diff: string,
  stagedFiles: string[],
  model: string,
  apiKey: string | null,
  provider: string
): Promise<string> {
  return invoke("generate_commit_message", { diff, stagedFiles, model, apiKey, provider });
}

// AI Code Review (streams via events)
export async function aiReviewCode(
  diff: string,
  stagedFiles: string[],
  model: string,
  apiKey: string | null,
  provider: string
): Promise<void> {
  return invoke("ai_review_code", { diff, stagedFiles, model, apiKey, provider });
}

export function onCodeReviewStart(
  callback: (files: string[]) => void
): Promise<UnlistenFn> {
  return listen<string[]>("code_review_start", (event) => callback(event.payload));
}

export function onCodeReviewStream(
  callback: (chunk: string) => void
): Promise<UnlistenFn> {
  return listen<string>("code_review_stream", (event) => callback(event.payload));
}

export function onCodeReviewDone(
  callback: (content: string) => void
): Promise<UnlistenFn> {
  return listen<string>("code_review_done", (event) => callback(event.payload));
}

export function onCodeReviewError(
  callback: (error: string) => void
): Promise<UnlistenFn> {
  return listen<string>("code_review_error", (event) => callback(event.payload));
}

// Git commands
export async function gitStatus(path: string): Promise<GitFileStatus[]> {
  return invoke("git_status", { path });
}

export async function gitDiff(path: string, file?: string): Promise<string> {
  return invoke("git_diff", { path, file: file ?? null });
}

export async function gitDiffCached(path: string): Promise<string> {
  return invoke("git_diff_cached", { path });
}

export async function gitShow(path: string, file: string, revision?: string): Promise<string> {
  return invoke("git_show", { path, file, revision: revision ?? null });
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

export interface CloneResult {
  target_path: string;
  slug: string;
}

export type CloneDepth = "shallow" | "single" | "full";

export async function gitClone(
  url: string,
  parentDir: string,
  folderName?: string,
  depth: CloneDepth = "shallow",
): Promise<CloneResult> {
  return invoke("git_clone", {
    url,
    parentDir,
    folderName: folderName ?? null,
    depth,
  });
}

export async function gitFetch(path: string): Promise<string> {
  return invoke("git_fetch", { path });
}

export async function gitPull(path: string): Promise<string> {
  return invoke("git_pull", { path });
}

export async function gitPush(path: string): Promise<string> {
  return invoke("git_push", { path });
}

export async function gitCreateBranch(path: string, branch: string): Promise<void> {
  return invoke("git_create_branch", { path, branch });
}

export async function gitAheadBehind(path: string): Promise<[number, number]> {
  return invoke("git_ahead_behind", { path });
}

export async function gitLog(path: string, count?: number): Promise<GitLogEntry[]> {
  return invoke("git_log", { path, count: count ?? null });
}

export async function gitRemoteUrl(path: string): Promise<string | null> {
  return invoke("git_remote_url", { path });
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

export function onGitChanged(
  callback: (data: { path: string; kind: string }) => void
): Promise<UnlistenFn> {
  return listen("git-changed", (event) => callback(event.payload as any));
}

// Agent commands
export async function agentChat(
  messages: { role: string; content: string }[],
  model: string,
  apiKey: string | null,
  provider: string,
  workspaceDir: string,
  context: string | null,
  conversationId: string | null = null,
): Promise<void> {
  return invoke("agent_chat", {
    messages,
    model,
    apiKey,
    provider,
    workspaceDir,
    context,
    conversationId,
  });
}

export async function agentStop(sessionId: string): Promise<void> {
  return invoke("agent_stop", { sessionId });
}

export async function agentApproveCommand(sessionId: string, approved: boolean): Promise<void> {
  return invoke("agent_approve_command", { sessionId, approved });
}

// CLIF.md project context
export async function clifProjectInitialized(workspaceDir: string): Promise<boolean> {
  return invoke("clif_project_initialized", { workspaceDir });
}

export async function clifReadContext(workspaceDir: string): Promise<string | null> {
  return invoke("clif_read_context", { workspaceDir });
}

export async function clifInitProject(
  workspaceDir: string,
  model: string,
  apiKey: string | null,
  provider: string,
): Promise<void> {
  return invoke("clif_init_project", { workspaceDir, model, apiKey, provider });
}

// Agent chat history persistence
export async function saveAgentHistory(workspaceDir: string, data: unknown): Promise<void> {
  return invoke("save_agent_history", { workspaceDir, data });
}

export async function loadAgentHistory(workspaceDir: string): Promise<unknown> {
  return invoke("load_agent_history", { workspaceDir });
}

// Agent event listeners
export function onAgentStream(callback: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>("agent_stream", (event) => callback(event.payload));
}

export function onAgentToolCall(
  callback: (data: { id: string; name: string; arguments: string }) => void
): Promise<UnlistenFn> {
  return listen("agent_tool_call", (event) => callback(event.payload as any));
}

export function onAgentToolResult(
  callback: (data: { tool_call_id: string; result: string }) => void
): Promise<UnlistenFn> {
  return listen("agent_tool_result", (event) => callback(event.payload as any));
}

export function onAgentDone(callback: () => void): Promise<UnlistenFn> {
  return listen("agent_done", () => callback());
}

export function onAgentError(callback: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>("agent_error", (event) => callback(event.payload));
}

// Security scanner
export interface SecurityIssue {
  file: string;
  line: number;
  severity: "critical" | "warning" | "info";
  category: string;
  description: string;
  snippet: string;
}

export async function scanFilesSecurity(paths: string[]): Promise<SecurityIssue[]> {
  return invoke("scan_files_security", { paths });
}

export async function scanRepoSecurity(workspaceDir: string): Promise<SecurityIssue[]> {
  return invoke("scan_repo_security", { workspaceDir });
}

// GitHub CLI integration
export interface GhAvailability {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  message: string | null;
}

export interface PrCheck {
  name: string | null;
  status: string | null;
  conclusion: string | null;
}

export interface PrCommitAuthor {
  name: string | null;
  email: string | null;
}

export interface PrCommit {
  oid: string | null;
  messageHeadline: string | null;
  committedDate: string | null;
  authors: PrCommitAuthor[] | null;
}

export interface PrReviewRequest {
  login: string | null;
}

export interface PrSummary {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string | null; name: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
  headRefName: string | null;
  baseRefName: string | null;
  mergeable: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commits: PrCommit[] | null;
  statusCheckRollup: PrCheck[] | null;
  reviewDecision: string | null;
  reviewRequests: PrReviewRequest[] | null;
}

export async function ghCheckAvailable(): Promise<GhAvailability> {
  return invoke("gh_check_available");
}

export async function ghListPrs(
  workspaceDir: string,
  state?: "open" | "closed" | "merged" | "all",
  limit?: number,
): Promise<PrSummary[]> {
  return invoke("gh_list_prs", {
    workspaceDir,
    state: state ?? null,
    limit: limit ?? null,
  });
}

export interface PrDetail {
  number: number;
  commits: PrCommit[];
  statusCheckRollup: PrCheck[];
  reviewRequests: PrReviewRequest[];
}

export async function ghPrDetail(workspaceDir: string, prNumber: number): Promise<PrDetail> {
  return invoke("gh_pr_detail", { workspaceDir, prNumber });
}

export async function prClassify(
  workspaceDir: string,
  prNumber: number,
): Promise<import("../types/classification").PrClassification> {
  return invoke("pr_classify", { workspaceDir, prNumber });
}

export async function prClassifyBatch(
  workspaceDir: string,
  prNumbers: number[],
): Promise<import("../types/classification").PrClassification[]> {
  return invoke("pr_classify_batch", { workspaceDir, prNumbers });
}

// ---------------------------------------------------------------------------
// Local Models (embedded LLM runtime — PRD: docs/PRD-local-models-tab.md)
// ---------------------------------------------------------------------------

import type {
  HardwareInfo,
  CatalogEntry,
  DownloadedModel,
  DownloadProgress,
  ResolvedModel,
  HfModelSummary,
  ModelVariants,
  DiscoveredModel,
} from "../types/localModels";

/** Scan Ollama / LM Studio / HF cache / Clif for already-downloaded GGUF models. */
export async function localScanExisting(): Promise<DiscoveredModel[]> {
  return invoke("local_scan_existing");
}

export async function localDetectHardware(): Promise<HardwareInfo> {
  return invoke("local_detect_hardware");
}

export async function localModelsCatalog(): Promise<CatalogEntry[]> {
  return invoke("local_models_catalog");
}

export async function localModelsList(): Promise<DownloadedModel[]> {
  return invoke("local_models_list");
}

/** Resolve a catalog model's exact GGUF filename + size from the HF API. */
export async function localModelResolve(
  id: string,
  token?: string | null,
): Promise<ResolvedModel> {
  return invoke("local_model_resolve", { id, token: token ?? null });
}

/** HF-verified detail for one catalog model (popularity + all quant options). */
export async function localModelVariants(
  id: string,
  token?: string | null,
): Promise<ModelVariants> {
  return invoke("local_model_variants", { id, token: token ?? null });
}

/** Search GGUF models on the Hugging Face Hub. */
export async function localModelsSearch(
  query: string,
  token?: string | null,
): Promise<HfModelSummary[]> {
  return invoke("local_models_search", { query, token: token ?? null });
}

export async function localModelDownload(
  id: string,
  token?: string | null,
): Promise<void> {
  return invoke("local_model_download", { id, token: token ?? null });
}

export async function localModelDelete(id: string): Promise<void> {
  return invoke("local_model_delete", { id });
}

export async function localModelSetActive(id: string): Promise<void> {
  return invoke("local_model_set_active", { id });
}

export async function localModelActive(): Promise<string | null> {
  return invoke("local_model_active");
}

export function onLocalModelDownloadProgress(
  callback: (p: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("local_model_download_progress", (e) =>
    callback(e.payload),
  );
}
