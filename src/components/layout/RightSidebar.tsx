import { Component, Show, For, createSignal, createMemo, lazy, Suspense } from "solid-js";
import { projectRoot, openFile } from "../../stores/fileStore";
import {
  isGitRepo, currentBranch, changedFiles, diffStat,
  stagedFiles, unstagedFiles, commitLog, fileNumstats,
  refreshGitStatus, stageFile, unstageFile, stageAll, unstageAll, commitChanges, initializeRepo,
} from "../../stores/gitStore";
import { devDrawerOpen, devDrawerHeight, setDevDrawerHeight } from "../../stores/uiStore";
import type { GitLogEntry } from "../../types/git";

const FileTree = lazy(() => import("../explorer/FileTree"));
const DevPreviewPanel = lazy(() => import("./DevPreviewPanel"));

type SidebarTab = "files" | "git";

const GitBranchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MinusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

function getStatusColor(status: string): string {
  switch (status) {
    case "modified": return "var(--accent-yellow)";
    case "added": case "new": return "var(--accent-green)";
    case "deleted": return "var(--accent-red)";
    case "renamed": return "var(--accent-blue)";
    case "untracked": return "var(--accent-green)";
    default: return "var(--text-muted)";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "modified": return "M";
    case "added": case "new": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "U";
    default: return "?";
  }
}

const FileRow: Component<{
  file: { path: string; status: string; staged: boolean };
  onAction: () => void;
  actionIcon: "stage" | "unstage";
}> = (props) => {
  const [hovered, setHovered] = createSignal(false);

  const fileName = () => {
    const parts = props.file.path.split("/");
    return parts[parts.length - 1];
  };

  const dirPath = () => {
    const parts = props.file.path.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/") + "/";
  };

  return (
    <div
      class="flex items-center gap-1 px-2 py-0.5 text-xs cursor-pointer"
      style={{
        color: "var(--text-primary)",
        background: hovered() ? "var(--bg-hover)" : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        const root = projectRoot();
        if (root && props.file.status !== "deleted") {
          openFile(root + "/" + props.file.path);
        }
      }}
    >
      <span
        class="shrink-0 font-mono font-bold"
        style={{
          color: getStatusColor(props.file.status),
          width: "14px",
          "text-align": "center",
          "font-size": "11px",
        }}
      >
        {getStatusLabel(props.file.status)}
      </span>
      <span class="truncate flex-1 min-w-0" title={props.file.path}>
        <span style={{ color: "var(--text-muted)" }}>{dirPath()}</span>
        {fileName()}
      </span>
      {(() => {
        const stats = fileNumstats().get(props.file.path);
        if (!stats || (stats.insertions < 0 && stats.deletions < 0)) return null;
        return (
          <span class="shrink-0 flex items-center gap-1 font-mono" style={{ "font-size": "10px" }}>
            <Show when={stats.insertions > 0}>
              <span style={{ color: "var(--accent-green)" }}>+{stats.insertions}</span>
            </Show>
            <Show when={stats.deletions > 0}>
              <span style={{ color: "var(--accent-red)" }}>-{stats.deletions}</span>
            </Show>
            <Show when={stats.insertions === 0 && stats.deletions === 0}>
              <span style={{ color: "var(--text-muted)" }}>0</span>
            </Show>
          </span>
        );
      })()}
      <Show when={hovered()}>
        <button
          class="shrink-0 flex items-center justify-center rounded"
          style={{
            width: "18px",
            height: "18px",
            color: "var(--text-secondary)",
            background: "var(--bg-active)",
          }}
          onClick={(e) => {
            e.stopPropagation();
            props.onAction();
          }}
          title={props.actionIcon === "stage" ? "Stage file" : "Unstage file"}
        >
          {props.actionIcon === "stage" ? <PlusIcon /> : <MinusIcon />}
        </button>
      </Show>
    </div>
  );
};

// Branch colors for the graph
const BRANCH_COLORS = [
  "var(--accent-blue)",
  "var(--accent-green)",
  "var(--accent-yellow)",
  "var(--accent-red)",
  "#c084fc", // purple
  "#f472b6", // pink
  "#2dd4bf", // teal
  "#fb923c", // orange
];

const GitGraphRow: Component<{
  entry: GitLogEntry;
  isLast: boolean;
  isMerge: boolean;
}> = (props) => {
  const [hovered, setHovered] = createSignal(false);

  const refLabels = createMemo(() => {
    return props.entry.refs.filter((r) => r !== "").map((r) => {
      const isHead = r.includes("HEAD");
      const cleaned = r.replace("HEAD -> ", "").replace("HEAD", "").trim();
      return { label: cleaned || (isHead ? "HEAD" : r), isHead };
    }).filter((r) => r.label);
  });

  return (
    <div
      class="flex items-start gap-2 px-2 py-1 text-xs cursor-default"
      style={{
        background: hovered() ? "var(--bg-hover)" : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Graph column */}
      <div
        class="shrink-0 flex flex-col items-center"
        style={{ width: "16px", "min-height": "28px" }}
      >
        {/* Line above dot */}
        <div
          style={{
            width: "2px",
            height: "6px",
            background: "var(--border-default)",
          }}
        />
        {/* Commit dot */}
        <div
          style={{
            width: props.entry.is_head ? "10px" : props.isMerge ? "8px" : "8px",
            height: props.entry.is_head ? "10px" : props.isMerge ? "8px" : "8px",
            "border-radius": "50%",
            background: props.entry.is_head
              ? "var(--accent-blue)"
              : props.isMerge
              ? "var(--accent-yellow)"
              : "var(--text-muted)",
            border: props.entry.is_head ? "2px solid var(--accent-blue)" : "none",
            "box-shadow": props.entry.is_head ? "0 0 6px rgba(59,130,246,0.5)" : "none",
            "flex-shrink": "0",
          }}
        />
        {/* Line below dot */}
        <Show when={!props.isLast}>
          <div
            style={{
              width: "2px",
              "flex-grow": "1",
              "min-height": "6px",
              background: "var(--border-default)",
            }}
          />
        </Show>
      </div>

      {/* Commit info */}
      <div class="flex-1 min-w-0 py-0.5">
        {/* Ref labels */}
        <Show when={refLabels().length > 0}>
          <div class="flex flex-wrap gap-1 mb-0.5">
            <For each={refLabels()}>
              {(ref, i) => (
                <span
                  class="px-1 rounded font-mono"
                  style={{
                    "font-size": "9px",
                    "line-height": "16px",
                    background: ref.isHead
                      ? "var(--accent-blue)"
                      : BRANCH_COLORS[i() % BRANCH_COLORS.length],
                    color: "#fff",
                    opacity: ref.isHead ? "1" : "0.85",
                  }}
                >
                  {ref.label}
                </span>
              )}
            </For>
          </div>
        </Show>
        {/* Message */}
        <div
          class="truncate"
          style={{
            color: "var(--text-primary)",
            "font-size": "11px",
            "line-height": "16px",
          }}
          title={props.entry.message}
        >
          {props.entry.message}
        </div>
        {/* Hash + author + date */}
        <div
          class="flex items-center gap-2 mt-0.5"
          style={{ color: "var(--text-muted)", "font-size": "10px" }}
        >
          <span class="font-mono" style={{ color: "var(--accent-yellow)" }}>
            {props.entry.short_hash}
          </span>
          <span class="truncate">{props.entry.author}</span>
          <span class="shrink-0 ml-auto">{props.entry.date}</span>
        </div>
      </div>
    </div>
  );
};

const RightSidebar: Component<{ onOpenFolder?: () => void }> = (props) => {
  const [activeTab, setActiveTab] = createSignal<SidebarTab>("files");
  const [commitMsg, setCommitMsg] = createSignal("");
  const [isCommitting, setIsCommitting] = createSignal(false);
  const [isDraggingDrawer, setIsDraggingDrawer] = createSignal(false);

  async function handleCommit() {
    const msg = commitMsg().trim();
    if (!msg) return;
    setIsCommitting(true);
    try {
      await commitChanges(msg);
      setCommitMsg("");
    } catch (e) {
      console.error("Commit failed:", e);
    } finally {
      setIsCommitting(false);
    }
  }

  let containerRef!: HTMLDivElement;

  function handleDrawerResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingDrawer(true);

    const onMouseMove = (e: MouseEvent) => {
      const rect = containerRef.getBoundingClientRect();
      const totalHeight = rect.height;
      const offsetY = e.clientY - rect.top;
      const topPct = (offsetY / totalHeight) * 100;
      const bottomPct = 100 - topPct;
      setDevDrawerHeight(Math.max(20, Math.min(80, bottomPct)));
    };

    const onMouseUp = () => {
      setIsDraggingDrawer(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      ref={containerRef}
      class="flex flex-col h-full overflow-hidden"
      style={{
        background: "var(--bg-surface)",
        "border-left": "1px solid var(--border-default)",
      }}
    >
      {/* Tab buttons */}
      <div
        class="flex shrink-0"
        style={{
          "border-bottom": "1px solid var(--border-default)",
          height: "36px",
        }}
      >
        <button
          class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
          style={{
            color: activeTab() === "files" ? "var(--text-primary)" : "var(--text-muted)",
            background: activeTab() === "files" ? "var(--bg-base)" : "transparent",
            "border-bottom": activeTab() === "files" ? "2px solid var(--accent-blue)" : "2px solid transparent",
          }}
          onClick={() => setActiveTab("files")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          Files
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
          style={{
            color: activeTab() === "git" ? "var(--text-primary)" : "var(--text-muted)",
            background: activeTab() === "git" ? "var(--bg-base)" : "transparent",
            "border-bottom": activeTab() === "git" ? "2px solid var(--accent-blue)" : "2px solid transparent",
          }}
          onClick={() => {
            setActiveTab("git");
            refreshGitStatus();
          }}
        >
          <GitBranchIcon />
          Git
          <Show when={changedFiles.length > 0}>
            <span
              class="flex items-center justify-center rounded-full"
              style={{
                "min-width": "16px",
                height: "16px",
                "font-size": "10px",
                background: "var(--accent-blue)",
                color: "#fff",
                "padding-left": "4px",
                "padding-right": "4px",
              }}
            >
              {changedFiles.length}
            </span>
          </Show>
        </button>
      </div>

      {/* Panel content — top pane */}
      <div
        class="overflow-y-auto min-h-0"
        style={{
          flex: devDrawerOpen() ? `0 0 ${100 - devDrawerHeight()}%` : "1 1 auto",
          transition: isDraggingDrawer() ? "none" : "flex 0.15s",
        }}
      >
        <Show when={activeTab() === "files"}>
          <Suspense>
            <FileTree onOpenFolder={props.onOpenFolder} />
          </Suspense>
        </Show>

        <Show when={activeTab() === "git"}>
          <div class="flex flex-col h-full">
            <Show when={isGitRepo()} fallback={
              <div class="flex flex-col items-center justify-center h-full gap-3 p-4">
                <GitBranchIcon />
                <p class="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  {projectRoot() ? "Not a git repository" : "Open a folder first"}
                </p>
                <Show when={projectRoot()}>
                  <button
                    class="px-3 py-1.5 rounded text-xs font-medium transition-colors"
                    style={{
                      background: "var(--accent-blue)",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                    onClick={async () => {
                      try {
                        await initializeRepo();
                      } catch (e) {
                        console.error("Failed to initialize git:", e);
                      }
                    }}
                  >
                    Initialize Git Repository
                  </button>
                </Show>
              </div>
            }>
              {/* Branch + stats */}
              <div
                class="shrink-0 px-3 py-2"
                style={{ "border-bottom": "1px solid var(--border-muted)" }}
              >
                <div class="flex items-center gap-2 mb-1.5">
                  <GitBranchIcon />
                  <span class="text-xs font-mono truncate font-medium" style={{ color: "var(--text-primary)" }}>
                    {currentBranch() || "main"}
                  </span>
                </div>
                <Show when={diffStat().files_changed > 0 || changedFiles.length > 0}>
                  <div class="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span>{changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""}</span>
                    <Show when={diffStat().insertions > 0}>
                      <span style={{ color: "var(--accent-green)" }}>+{diffStat().insertions}</span>
                    </Show>
                    <Show when={diffStat().deletions > 0}>
                      <span style={{ color: "var(--accent-red)" }}>-{diffStat().deletions}</span>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Commit input */}
              <div class="shrink-0 p-2" style={{ "border-bottom": "1px solid var(--border-muted)" }}>
                <input
                  type="text"
                  class="w-full text-xs rounded px-2 py-1.5 outline-none"
                  style={{
                    background: "var(--bg-base)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                  }}
                  placeholder="Commit message..."
                  value={commitMsg()}
                  onInput={(e) => setCommitMsg(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commitMsg().trim()) handleCommit();
                  }}
                />
                <button
                  class="w-full mt-1.5 py-1 rounded text-xs font-medium transition-colors"
                  style={{
                    background: commitMsg().trim() && stagedFiles().length > 0
                      ? "var(--accent-blue)" : "var(--bg-hover)",
                    color: commitMsg().trim() && stagedFiles().length > 0
                      ? "#fff" : "var(--text-muted)",
                    cursor: commitMsg().trim() && stagedFiles().length > 0
                      ? "pointer" : "not-allowed",
                  }}
                  disabled={!commitMsg().trim() || stagedFiles().length === 0 || isCommitting()}
                  onClick={handleCommit}
                >
                  {isCommitting() ? "Committing..." : `Commit (${stagedFiles().length} staged)`}
                </button>
              </div>

              {/* Staged changes */}
              <Show when={stagedFiles().length > 0}>
                <div class="shrink-0">
                  <div
                    class="flex items-center justify-between px-2 py-1.5"
                    style={{ "border-bottom": "1px solid var(--border-muted)" }}
                  >
                    <span class="text-xs font-medium" style={{ color: "var(--accent-green)" }}>
                      Staged ({stagedFiles().length})
                    </span>
                    <button
                      class="text-xs px-1.5 py-0.5 rounded transition-colors"
                      style={{ color: "var(--text-muted)", background: "transparent" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                      onClick={() => unstageAll()}
                      title="Unstage all"
                    >
                      Unstage All
                    </button>
                  </div>
                  <For each={stagedFiles()}>
                    {(file) => (
                      <FileRow
                        file={file}
                        onAction={() => unstageFile(file.path)}
                        actionIcon="unstage"
                      />
                    )}
                  </For>
                </div>
              </Show>

              {/* Unstaged changes */}
              <Show when={unstagedFiles().length > 0}>
                <div class="shrink-0">
                  <div
                    class="flex items-center justify-between px-2 py-1.5"
                    style={{ "border-bottom": "1px solid var(--border-muted)" }}
                  >
                    <span class="text-xs font-medium" style={{ color: "var(--accent-yellow)" }}>
                      Changes ({unstagedFiles().length})
                    </span>
                    <button
                      class="text-xs px-1.5 py-0.5 rounded transition-colors"
                      style={{ color: "var(--text-muted)", background: "transparent" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                      onClick={() => stageAll()}
                      title="Stage all"
                    >
                      Stage All
                    </button>
                  </div>
                  <For each={unstagedFiles()}>
                    {(file) => (
                      <FileRow
                        file={file}
                        onAction={() => stageFile(file.path)}
                        actionIcon="stage"
                      />
                    )}
                  </For>
                </div>
              </Show>

              {/* No changes state */}
              <Show when={changedFiles.length === 0}>
                <div class="flex items-center justify-center py-4">
                  <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                    No changes
                  </p>
                </div>
              </Show>

              {/* Git Graph */}
              <Show when={commitLog().length > 0}>
                <div
                  class="shrink-0"
                  style={{ "border-top": "1px solid var(--border-muted)" }}
                >
                  <div
                    class="flex items-center justify-between px-2 py-1.5"
                    style={{ "border-bottom": "1px solid var(--border-muted)" }}
                  >
                    <span class="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Commits ({commitLog().length})
                    </span>
                  </div>
                  <div class="overflow-y-auto" style={{ "max-height": "300px" }}>
                    <For each={commitLog()}>
                      {(entry, idx) => (
                        <GitGraphRow
                          entry={entry}
                          isLast={idx() === commitLog().length - 1}
                          isMerge={entry.parents.length > 1}
                        />
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Refresh button */}
              <div class="p-2 mt-auto shrink-0">
                <button
                  class="w-full py-1 rounded text-xs transition-colors"
                  style={{
                    color: "var(--text-muted)",
                    background: "transparent",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                  onClick={() => refreshGitStatus()}
                >
                  Refresh
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Resize handle between top pane and Dev Preview */}
      <Show when={devDrawerOpen()}>
        <div
          class="shrink-0 cursor-row-resize"
          style={{
            height: "5px",
            background: isDraggingDrawer() ? "var(--accent-primary)" : "var(--border-default)",
            transition: isDraggingDrawer() ? "none" : "background 0.15s",
          }}
          onMouseDown={handleDrawerResize}
          onMouseEnter={(e) => {
            if (!isDraggingDrawer()) {
              (e.currentTarget as HTMLElement).style.background = "var(--accent-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isDraggingDrawer()) {
              (e.currentTarget as HTMLElement).style.background = "var(--border-default)";
            }
          }}
        />
      </Show>

      {/* Dev Preview Panel — bottom pane */}
      <div
        style={{
          flex: devDrawerOpen() ? `0 0 ${devDrawerHeight()}%` : "0 0 auto",
          transition: isDraggingDrawer() ? "none" : "flex 0.15s",
          "min-height": "32px",
        }}
      >
        <Suspense>
          <DevPreviewPanel />
        </Suspense>
      </div>
    </div>
  );
};

export default RightSidebar;
