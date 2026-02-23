import { Component, Show } from "solid-js";
import { activeFile, projectRoot } from "../../stores/fileStore";
import { isGitRepo, currentBranch } from "../../stores/gitStore";
import { theme, THEMES } from "../../stores/uiStore";

const TerminalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const StatusBar: Component = () => {
  const filePath = () => {
    const file = activeFile();
    return file ? file.path : "";
  };

  const language = () => {
    const file = activeFile();
    return file ? file.language : "";
  };

  return (
    <div
      class="flex items-center justify-between shrink-0 select-none transition-theme"
      style={{
        height: "var(--status-bar-height)",
        background: "var(--bg-surface)",
        "border-top": "1px solid var(--border-muted)",
        "font-size": "12px",
        "font-family": "var(--font-sans)",
        "padding-left": "8px",
        "padding-right": "8px",
      }}
    >
      {/* Left section */}
      <div class="flex items-center gap-3 min-w-0">
        {/* Git branch */}
        <Show when={isGitRepo()}>
          <div
            class="flex items-center gap-1.5 shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="truncate" style={{ "max-width": "120px" }}>
              {currentBranch() || "main"}
            </span>
          </div>
        </Show>

        {/* Terminal indicator */}
        <div
          class="flex items-center gap-1.5 shrink-0"
          style={{ color: "var(--accent-green)" }}
        >
          <TerminalIcon />
          <span>Terminal</span>
        </div>

        {/* File path */}
        <Show when={filePath()}>
          <div
            class="truncate"
            style={{
              color: "var(--text-muted)",
              "max-width": "300px",
            }}
            title={filePath()}
          >
            {filePath()}
          </div>
        </Show>
      </div>

      {/* Center spacer */}
      <div class="flex-1" />

      {/* Right section */}
      <div class="flex items-center gap-3 shrink-0">
        <Show when={activeFile()}>
          <span style={{ color: "var(--text-muted)" }}>
            Ln 1, Col 1
          </span>
        </Show>

        <Show when={language()}>
          <span style={{ color: "var(--text-secondary)" }}>
            {language()}
          </span>
        </Show>

        <Show when={activeFile()}>
          <span style={{ color: "var(--text-muted)" }}>
            UTF-8
          </span>
        </Show>

        {/* AgentBase label with accent */}
        <div
          class="flex items-center gap-1.5"
          style={{ color: "var(--accent-primary)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
          </svg>
          <span class="text-xs">AgentBase</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
