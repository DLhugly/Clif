import { Component, Show, createSignal, onMount } from "solid-js";
import { activeFile, projectRoot } from "../../stores/fileStore";
import { isGitRepo, currentBranch, aheadBehind, fetchRemote } from "../../stores/gitStore";
import {
  agentVisible,
  toggleAgentPanel,
  terminalVisible,
  toggleTerminal,
  editorVisible,
  toggleEditor,
} from "../../stores/uiStore";
import {
  indexStatus,
  indexProgress,
  isBuilding,
  buildIndex,
} from "../../stores/indexStore";
import { checkForUpdate, installUpdate, type UpdateStatus } from "../../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

// ---------------------------------------------------------------------------
// Inline SVG icons — kept at the top so the render function stays readable.
// ---------------------------------------------------------------------------

const TerminalIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const EditorIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

const AgentIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
);

const GitIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

// ---------------------------------------------------------------------------
// PillButton: reusable small pill for panel toggles. Mirrors the visual
// language used in TopBar so the three panel toggles (Terminal,
// Editor, Agent) all look and feel consistent across the app.
// ---------------------------------------------------------------------------

const PillButton: Component<{
  label: string;
  labelOn?: string;
  active: boolean;
  onClick: () => void;
  title: string;
  children: any;
}> = (p) => {
  const effectiveLabel = () => (p.active && p.labelOn ? p.labelOn : p.label);
  return (
    <button
      class="flex items-center gap-1.5 rounded-full shrink-0 transition-colors"
      style={{
        background: p.active ? "color-mix(in srgb, var(--accent-primary) 18%, transparent)" : "var(--bg-hover)",
        color: p.active ? "var(--accent-primary)" : "var(--text-muted)",
        border: `1px solid ${p.active ? "color-mix(in srgb, var(--accent-primary) 32%, transparent)" : "var(--border-default)"}`,
        padding: "2px 10px",
        height: "20px",
        cursor: "pointer",
        "font-size": "11px",
        "font-weight": p.active ? "600" : "500",
        "letter-spacing": "0.01em",
      }}
      onMouseEnter={(e) => {
        if (!p.active) (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = p.active
          ? "color-mix(in srgb, var(--accent-primary) 18%, transparent)"
          : "var(--bg-hover)";
      }}
      onClick={p.onClick}
      title={p.title}
    >
      {p.children}
      <span>{effectiveLabel()}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

const StatusBar: Component<{ onShowAbout?: () => void }> = (_props) => {
  const [appVersion, setAppVersion] = createSignal("...");
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>({ state: "idle" });
  const [pendingUpdate, setPendingUpdate] = createSignal<Update | null>(null);

  const projectPathDisplay = () => {
    const root = projectRoot();
    if (!root) return "";
    const parts = root.split("/").filter(Boolean);
    return parts.slice(-3).join("/");
  };

  const filePath = () => activeFile()?.path ?? "";
  const language = () => activeFile()?.language ?? "";

  onMount(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => {});
    setTimeout(async () => {
      try {
        const update = await checkForUpdate();
        if (update) {
          setPendingUpdate(update);
          setUpdateStatus({ state: "available", version: update.version, update });
        }
      } catch {
        // Updater endpoint unreachable — fail silently
      }
    }, 3000);
  });

  const handleUpdateClick = async () => {
    const update = pendingUpdate();
    if (!update) return;
    setUpdateStatus({ state: "downloading", progress: 0 });
    try {
      await installUpdate(update, (progress) => {
        setUpdateStatus({ state: "downloading", progress });
      });
    } catch (e) {
      setUpdateStatus({
        state: "error",
        message: e instanceof Error ? e.message : "Update failed",
      });
    }
  };

  const updateLabel = () => {
    const s = updateStatus();
    switch (s.state) {
      case "checking":
        return "Checking…";
      case "up-to-date":
        return "Up to date";
      case "available":
        return `Update v${s.version}`;
      case "downloading":
        return `Updating ${s.progress}%`;
      case "installing":
        return "Installing…";
      case "error":
        return "Update failed";
      default:
        return `v${appVersion()}`;
    }
  };

  async function forceCheckUpdate() {
    setUpdateStatus({ state: "checking" });
    try {
      const update = await checkForUpdate();
      if (update) {
        setPendingUpdate(update);
        setUpdateStatus({ state: "available", version: update.version, update });
      } else {
        setUpdateStatus({ state: "up-to-date" });
        setTimeout(() => setUpdateStatus({ state: "idle" }), 3000);
      }
    } catch (e) {
      setUpdateStatus({
        state: "error",
        message: e instanceof Error ? e.message : "Could not reach update server",
      });
      setTimeout(() => setUpdateStatus({ state: "idle" }), 4000);
    }
  }

  const isClickable = () => {
    const s = updateStatus().state;
    return s === "available" || s === "error";
  };

  return (
    <div
      class="flex items-center justify-between shrink-0 select-none transition-theme"
      style={{
        height: "var(--status-bar-height)",
        background: "var(--bg-surface)",
        "border-top": "1px solid var(--border-muted)",
        "font-size": "11px",
        "font-family": "var(--font-sans)",
        padding: "0 8px",
        gap: "8px",
      }}
    >
      {/* Left: Terminal pill · Git chip · path info */}
      <div class="flex items-center gap-2 min-w-0" style={{ "flex-shrink": "1" }}>
        <PillButton
          label="Terminal"
          labelOn="Terminal"
          active={terminalVisible()}
          onClick={() => toggleTerminal()}
          title={terminalVisible() ? "Hide terminal (⌘`)" : "Show terminal (⌘`)"}
        >
          <TerminalIcon />
        </PillButton>

        <Show when={isGitRepo()}>
          <div
            class="flex items-center gap-1 shrink-0 statusbar-git"
            style={{ color: "var(--text-muted)", cursor: "pointer" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            }}
            title="Click to fetch from remote"
            onClick={() => {
              fetchRemote().catch(() => {});
            }}
          >
            <GitIcon />
            <span class="truncate" style={{ "max-width": "120px" }}>
              {currentBranch() || "main"}
            </span>
            <Show when={aheadBehind().ahead > 0 || aheadBehind().behind > 0}>
              <span
                class="flex items-center gap-0.5"
                style={{ "font-size": "10px", "font-family": "var(--font-mono, monospace)" }}
              >
                <Show when={aheadBehind().ahead > 0}>
                  <span style={{ color: "var(--accent-green)" }}>↑{aheadBehind().ahead}</span>
                </Show>
                <Show when={aheadBehind().behind > 0}>
                  <span style={{ color: "var(--accent-blue)" }}>↓{aheadBehind().behind}</span>
                </Show>
              </span>
            </Show>
          </div>
        </Show>

        <Show when={projectPathDisplay()}>
          <div
            class="truncate statusbar-path"
            style={{
              color: "var(--text-muted)",
              "max-width": "180px",
              opacity: 0.75,
            }}
            title={projectRoot() || ""}
          >
            {projectPathDisplay()}
          </div>
        </Show>

        <Show when={filePath()}>
          <div
            class="truncate statusbar-file"
            style={{
              color: "var(--text-muted)",
              "max-width": "220px",
            }}
            title={filePath()}
          >
            {filePath()}
          </div>
        </Show>
      </div>

      {/* Center: Editor pill · index chip · tiny file meta */}
      <div class="flex items-center gap-2 shrink-0">
        <PillButton
          label="Editor"
          active={editorVisible()}
          onClick={() => toggleEditor()}
          title={editorVisible() ? "Hide editor" : "Show editor"}
        >
          <EditorIcon />
        </PillButton>

        {/* Index chip — progress while building, muted badge when ready. */}
        {(() => {
          const status = () => indexStatus();
          const progress = () => indexProgress();
          const building = () => isBuilding();
          const phase = () => progress()?.phase;
          const phaseLabel = () => {
            switch (phase()) {
              case "scan":
                return "Scanning…";
              case "recency":
                return "Reading git log…";
              case "symbols":
                return `Parsing ${progress()?.current ?? 0}/${progress()?.total ?? "?"}`;
              case "postings":
                return "Building index…";
              case "save":
                return "Saving…";
              case "done":
                return "Index ready";
              case "error":
                return "Index failed";
              default:
                return "Indexing…";
            }
          };
          const isError = () => phase() === "error" || status().state === "error";
          const isReady = () => status().state === "ready" && !building();
          const isRunning = () => building() || (progress() && phase() !== "done" && phase() !== "error");
          return (
            <Show when={building() || progress() || status().state !== "missing"}>
              <button
                class="statusbar-index flex items-center gap-1.5 rounded-full transition-colors"
                style={{
                  background: isError()
                    ? "color-mix(in srgb, var(--accent-red) 14%, transparent)"
                    : isRunning()
                    ? "color-mix(in srgb, var(--accent-yellow) 14%, transparent)"
                    : "var(--bg-hover)",
                  color: isError()
                    ? "var(--accent-red)"
                    : isRunning()
                    ? "var(--accent-yellow)"
                    : "var(--text-muted)",
                  border: `1px solid ${
                    isError()
                      ? "color-mix(in srgb, var(--accent-red) 34%, transparent)"
                      : isRunning()
                      ? "color-mix(in srgb, var(--accent-yellow) 34%, transparent)"
                      : "var(--border-default)"
                  }`,
                  cursor: "pointer",
                  padding: "2px 10px",
                  height: "20px",
                  "font-size": "11px",
                  "font-weight": "500",
                }}
                onClick={() => {
                  if (!building()) void buildIndex();
                }}
                title={
                  isError()
                    ? `Index error: ${status().error ?? "unknown"} — click to retry`
                    : isRunning()
                    ? "Building codebase index…"
                    : isReady()
                    ? `Index ready · ${status().file_count} files · ${status().symbol_count} symbols (click to rebuild)`
                    : "Click to build codebase index"
                }
              >
                <Show
                  when={isRunning()}
                  fallback={
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  }
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="animate-spin"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </Show>
                <span>
                  {isRunning() ? phaseLabel() : isError() ? "Index failed" : "Index"}
                </span>
                <Show when={isReady() && !isRunning()}>
                  <span
                    style={{
                      opacity: 0.7,
                      "font-family": "var(--font-mono, monospace)",
                      "font-size": "10px",
                    }}
                  >
                    {status().file_count}
                  </span>
                </Show>
              </button>
            </Show>
          );
        })()}

        <Show when={language() || activeFile()}>
          <span
            class="statusbar-filemeta"
            style={{
              color: "var(--text-muted)",
              "font-size": "10px",
              "font-family": "var(--font-mono, monospace)",
              opacity: 0.7,
            }}
          >
            <Show when={language()}>{language()}</Show>
            <Show when={language() && activeFile()}>{" · "}</Show>
            <Show when={activeFile()}>UTF-8</Show>
          </span>
        </Show>
      </div>

      {/* Right: Agent pill · version/update chip */}
      <div class="flex items-center gap-2 shrink-0">
        <PillButton
          label="Agent"
          labelOn="Agent"
          active={agentVisible()}
          onClick={() => toggleAgentPanel()}
          title={agentVisible() ? "Hide agent panel" : "Show agent panel"}
        >
          <AgentIcon />
        </PillButton>

        <Show when={!isClickable()}>
          <div
            class="flex items-center gap-1 statusbar-version"
            style={{
              color:
                updateStatus().state === "downloading" || updateStatus().state === "installing"
                  ? "var(--accent-yellow)"
                  : updateStatus().state === "up-to-date"
                  ? "var(--accent-green)"
                  : updateStatus().state === "checking"
                  ? "var(--text-muted)"
                  : "var(--text-muted)",
              cursor:
                updateStatus().state === "idle" || updateStatus().state === "up-to-date"
                  ? "pointer"
                  : "default",
              "font-size": "10px",
              "font-family": "var(--font-mono, monospace)",
              opacity: 0.85,
            }}
            title={
              updateStatus().state === "idle"
                ? `ClifPad v${appVersion()} — click to check for updates`
                : updateStatus().state === "up-to-date"
                ? "Already on latest version"
                : undefined
            }
            onClick={() => {
              if (updateStatus().state === "idle") forceCheckUpdate();
            }}
            onMouseEnter={(e) => {
              if (updateStatus().state === "idle") (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.85";
            }}
          >
            <SparkleIcon />
            <span>{updateLabel()}</span>
          </div>
        </Show>

        <Show when={isClickable()}>
          <button
            class="flex items-center gap-1 rounded-full"
            style={{
              color:
                updateStatus().state === "error" ? "var(--accent-red)" : "var(--accent-primary)",
              background:
                updateStatus().state === "error"
                  ? "color-mix(in srgb, var(--accent-red) 15%, transparent)"
                  : "color-mix(in srgb, var(--accent-primary) 15%, transparent)",
              border: `1px solid ${
                updateStatus().state === "error"
                  ? "color-mix(in srgb, var(--accent-red) 30%, transparent)"
                  : "color-mix(in srgb, var(--accent-primary) 30%, transparent)"
              }`,
              padding: "1px 8px",
              cursor: "pointer",
              "font-size": "10.5px",
              "font-weight": "600",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
            onClick={handleUpdateClick}
            title={
              updateStatus().state === "available"
                ? "Click to install update and restart"
                : "Click to retry update"
            }
          >
            <SparkleIcon />
            <span>{updateLabel()}</span>
          </button>
        </Show>
      </div>

      {/* Progressive collapse: hide meta under narrow widths to keep the
          three pills comfortable. */}
      <style>{`
        @media (max-width: 1100px) {
          .statusbar-filemeta { display: none !important; }
        }
        @media (max-width: 960px) {
          .statusbar-file { display: none !important; }
        }
        @media (max-width: 820px) {
          .statusbar-path { display: none !important; }
        }
        @media (max-width: 700px) {
          .statusbar-git { display: none !important; }
          .statusbar-version { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default StatusBar;
