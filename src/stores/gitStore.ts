import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { GitFileStatus, GitBranch, GitLogEntry } from "../types/git";
import { gitStatus, gitDiff, gitBranches, gitStage, gitUnstage, gitCommit, gitDiffStat, gitDiffNumstat, gitInit, gitLog } from "../lib/tauri";
import { projectRoot } from "./fileStore";

const [currentBranch, setCurrentBranch] = createSignal<string>("");
const [isGitRepo, setIsGitRepo] = createSignal(false);
const [changedFiles, setChangedFiles] = createStore<GitFileStatus[]>([]);
const [branches, setBranches] = createStore<GitBranch[]>([]);
const [diffStat, setDiffStat] = createSignal<{ files_changed: number; insertions: number; deletions: number }>({ files_changed: 0, insertions: 0, deletions: 0 });
const [commitLog, setCommitLog] = createSignal<GitLogEntry[]>([]);
const [fileNumstats, setFileNumstats] = createSignal<Map<string, { insertions: number; deletions: number }>>(new Map());

const stagedFiles = () => changedFiles.filter((f) => f.staged);
const unstagedFiles = () => changedFiles.filter((f) => !f.staged);

async function refreshGitStatus() {
  const root = projectRoot();
  if (!root) return;

  try {
    const files = await gitStatus(root);
    setChangedFiles(files);
    setIsGitRepo(true);

    // Also fetch diff stats, per-file numstats, and log
    try {
      const stat = await gitDiffStat(root);
      setDiffStat(stat);
    } catch {
      setDiffStat({ files_changed: 0, insertions: 0, deletions: 0 });
    }
    try {
      const numstats = await gitDiffNumstat(root);
      const map = new Map<string, { insertions: number; deletions: number }>();
      for (const ns of numstats) {
        map.set(ns.path, { insertions: ns.insertions, deletions: ns.deletions });
      }
      setFileNumstats(map);
    } catch {
      setFileNumstats(new Map());
    }
    refreshLog();
  } catch {
    setIsGitRepo(false);
    setChangedFiles([]);
    setDiffStat({ files_changed: 0, insertions: 0, deletions: 0 });
    setCommitLog([]);
  }
}

async function refreshLog() {
  const root = projectRoot();
  if (!root) return;

  try {
    const entries = await gitLog(root, 50);
    setCommitLog(entries);
  } catch {
    setCommitLog([]);
  }
}

async function refreshBranches() {
  const root = projectRoot();
  if (!root) return;

  try {
    const b = await gitBranches(root);
    setBranches(b);
    const current = b.find((br) => br.is_current);
    if (current) setCurrentBranch(current.name);
  } catch {
    setBranches([]);
  }
}

async function stageFile(filePath: string) {
  const root = projectRoot();
  if (!root) return;
  await gitStage(root, [filePath]);
  await refreshGitStatus();
}

async function unstageFile(filePath: string) {
  const root = projectRoot();
  if (!root) return;
  await gitUnstage(root, [filePath]);
  await refreshGitStatus();
}

async function stageAll() {
  const root = projectRoot();
  if (!root) return;
  const files = unstagedFiles().map((f) => f.path);
  if (files.length === 0) return;
  await gitStage(root, files);
  await refreshGitStatus();
}

async function unstageAll() {
  const root = projectRoot();
  if (!root) return;
  const files = stagedFiles().map((f) => f.path);
  if (files.length === 0) return;
  await gitUnstage(root, files);
  await refreshGitStatus();
}

async function commitChanges(message: string) {
  const root = projectRoot();
  if (!root) return;
  await gitCommit(root, message);
  await refreshGitStatus();
  await refreshBranches();
}

async function initializeRepo() {
  const root = projectRoot();
  if (!root) return;
  await gitInit(root);
  await refreshGitStatus();
  await refreshBranches();
}

async function initGit() {
  await refreshGitStatus();
  await refreshBranches();
}

export {
  currentBranch,
  isGitRepo,
  changedFiles,
  branches,
  diffStat,
  stagedFiles,
  unstagedFiles,
  commitLog,
  fileNumstats,
  refreshGitStatus,
  refreshBranches,
  refreshLog,
  stageFile,
  unstageFile,
  stageAll,
  unstageAll,
  commitChanges,
  initializeRepo,
  initGit,
};
