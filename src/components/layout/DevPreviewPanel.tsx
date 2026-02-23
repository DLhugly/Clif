import { Component, onMount, onCleanup, createSignal, createEffect, Show, For } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, onPtyOutput, onPtyExit } from "../../lib/tauri";
import { theme, fontSize, devDrawerOpen, setDevDrawerOpen } from "../../stores/uiStore";
import { projectRoot } from "../../stores/fileStore";
import type { Theme } from "../../stores/uiStore";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

const terminalThemes: Record<Theme, Record<string, string>> = {
  midnight: {
    background: "#0d1117",
    foreground: "#e6edf3",
    cursor: "#3b82f6",
    cursorAccent: "#0d1117",
    selectionBackground: "rgba(59, 130, 246, 0.3)",
    black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
    blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
    brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
    brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
  },
  graphite: {
    background: "#1c1c1e",
    foreground: "#f5f5f7",
    cursor: "#f0883e",
    cursorAccent: "#1c1c1e",
    selectionBackground: "rgba(240, 136, 62, 0.3)",
    black: "#48484a", red: "#ff453a", green: "#30d158", yellow: "#ffd60a",
    blue: "#64d2ff", magenta: "#bf5af2", cyan: "#5ac8fa", white: "#d1d1d6",
    brightBlack: "#8e8e93", brightRed: "#ff6961", brightGreen: "#4cd964", brightYellow: "#ffe066",
    brightBlue: "#70d7ff", brightMagenta: "#da8fff", brightCyan: "#70d7ff", brightWhite: "#f5f5f7",
  },
  dawn: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0066cc",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 102, 204, 0.2)",
    black: "#24292f", red: "#cf222e", green: "#1a7f37", yellow: "#9a6700",
    blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#2da44e", brightYellow: "#bf8700",
    brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
  },
  arctic: {
    background: "#f0f4f8",
    foreground: "#0f172a",
    cursor: "#0284c7",
    cursorAccent: "#f0f4f8",
    selectionBackground: "rgba(2, 132, 199, 0.2)",
    black: "#334155", red: "#dc2626", green: "#059669", yellow: "#d97706",
    blue: "#0284c7", magenta: "#7c3aed", cyan: "#0891b2", white: "#64748b",
    brightBlack: "#475569", brightRed: "#ef4444", brightGreen: "#10b981", brightYellow: "#f59e0b",
    brightBlue: "#0ea5e9", brightMagenta: "#8b5cf6", brightCyan: "#06b6d4", brightWhite: "#94a3b8",
  },
  dusk: {
    background: "#1a1625",
    foreground: "#ede9fe",
    cursor: "#a855f7",
    cursorAccent: "#1a1625",
    selectionBackground: "rgba(168, 85, 247, 0.3)",
    black: "#372f48", red: "#fb7185", green: "#34d399", yellow: "#fbbf24",
    blue: "#818cf8", magenta: "#c084fc", cyan: "#67e8f9", white: "#a78bfa",
    brightBlack: "#7c6ba0", brightRed: "#fda4af", brightGreen: "#6ee7b7", brightYellow: "#fde68a",
    brightBlue: "#a5b4fc", brightMagenta: "#d8b4fe", brightCyan: "#a5f3fc", brightWhite: "#ede9fe",
  },
};

const PRESET_COMMANDS = [
  { label: "npm run dev", cmd: "npm run dev" },
  { label: "npm start", cmd: "npm start" },
];

const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/;

const PlayIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const DevPreviewPanel: Component = () => {
  let terminalContainerRef!: HTMLDivElement;
  let terminal: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [previewUrl, setPreviewUrl] = createSignal("");
  const [urlInput, setUrlInput] = createSignal("");
  const [customCmd, setCustomCmd] = createSignal("");
  const [isRunning, setIsRunning] = createSignal(false);
  const [iframeKey, setIframeKey] = createSignal(0);
  let unlistenOutput: UnlistenFn | undefined;
  let unlistenExit: UnlistenFn | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let dataDisposable: { dispose: () => void } | undefined;
  let alive = true;
  let terminalMounted = false;

  async function spawnSession() {
    if (!terminal || !fitAddon) return;

    unlistenOutput?.();
    unlistenExit?.();
    dataDisposable?.dispose();

    const workingDir = projectRoot() || undefined;

    try {
      const sid = await ptySpawn(workingDir);
      setSessionId(sid);

      unlistenOutput = await onPtyOutput((event) => {
        if (event.session_id === sid && event.data) {
          terminal?.write(event.data);

          // Auto-detect URLs from terminal output
          const match = event.data.match(URL_PATTERN);
          if (match) {
            const detected = match[0];
            setPreviewUrl(detected);
            setUrlInput(detected);
          }
        }
      });

      unlistenExit = await onPtyExit((event) => {
        if (event.session_id === sid && alive) {
          setIsRunning(false);
          terminal?.write("\r\n\x1b[33m[Process exited]\x1b[0m\r\n");
        }
      });

      const dims = fitAddon.proposeDimensions();
      if (dims) {
        await ptyResize(sid, dims.cols, dims.rows);
      }

      dataDisposable = terminal.onData((data) => {
        ptyWrite(sid, data);
      });
    } catch (e) {
      terminal?.write(`\r\n\x1b[31mFailed to start dev terminal: ${e}\x1b[0m\r\n`);
    }
  }

  function runCommand(cmd: string) {
    const sid = sessionId();
    if (sid) {
      ptyWrite(sid, cmd + "\n");
      setIsRunning(true);
    }
  }

  function stopProcess() {
    const sid = sessionId();
    if (sid) {
      // Send Ctrl+C
      ptyWrite(sid, "\x03");
      setIsRunning(false);
    }
  }

  function navigateToUrl() {
    const url = urlInput().trim();
    if (url) {
      setPreviewUrl(url);
      setIframeKey((k) => k + 1);
    }
  }

  function initTerminal() {
    if (terminalMounted) return;
    terminalMounted = true;

    const t = theme();
    terminal = new Terminal({
      fontSize: Math.max(11, fontSize() - 1),
      fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
      theme: terminalThemes[t],
      rows: 8,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef);

    requestAnimationFrame(() => {
      fitAddon?.fit();
    });

    spawnSession();

    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddon && terminal) {
          fitAddon.fit();
          const sid = sessionId();
          if (sid) {
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              ptyResize(sid, dims.cols, dims.rows);
            }
          }
        }
      });
    });
    resizeObserver.observe(terminalContainerRef);
  }

  // Initialize terminal when drawer opens
  createEffect(() => {
    if (devDrawerOpen()) {
      // Small delay to ensure DOM is rendered
      requestAnimationFrame(() => {
        initTerminal();
      });
    }
  });

  // Watch theme changes
  createEffect(() => {
    const t = theme();
    if (terminal) {
      terminal.options.theme = terminalThemes[t];
    }
  });

  // Watch font size changes
  createEffect(() => {
    const size = fontSize();
    if (terminal) {
      terminal.options.fontSize = Math.max(11, size - 1);
      fitAddon?.fit();
    }
  });

  onCleanup(async () => {
    alive = false;
    resizeObserver?.disconnect();
    unlistenOutput?.();
    unlistenExit?.();
    dataDisposable?.dispose();
    terminal?.dispose();
    const sid = sessionId();
    if (sid) {
      try {
        await ptyKill(sid);
      } catch {
        // Session may already be dead
      }
    }
  });

  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
      {/* Header */}
      <div
        class="flex items-center justify-between shrink-0 px-2 cursor-pointer select-none"
        style={{
          height: "32px",
          "border-bottom": "1px solid var(--border-default)",
          background: "var(--bg-surface)",
        }}
        onClick={() => setDevDrawerOpen(!devDrawerOpen())}
      >
        <div class="flex items-center gap-1.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{
              color: "var(--text-muted)",
              transform: devDrawerOpen() ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.15s",
            }}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
          <span class="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Dev Preview
          </span>
          <Show when={isRunning()}>
            <span
              class="inline-block rounded-full"
              style={{
                width: "6px",
                height: "6px",
                background: "var(--accent-green)",
                "box-shadow": "0 0 4px var(--accent-green)",
              }}
            />
          </Show>
        </div>
        <button
          class="flex items-center justify-center rounded"
          style={{
            width: "20px",
            height: "20px",
            color: "var(--text-muted)",
            background: "transparent",
          }}
          onClick={(e) => {
            e.stopPropagation();
            setDevDrawerOpen(false);
          }}
          title="Close Dev Preview"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Expandable content */}
      <Show when={devDrawerOpen()}>
        <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Hot buttons row */}
          <div
            class="flex items-center gap-1 shrink-0 px-2 py-1.5 flex-wrap"
            style={{ "border-bottom": "1px solid var(--border-muted)" }}
          >
            <For each={PRESET_COMMANDS}>
              {(preset) => (
                <button
                  class="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--accent-blue)";
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-blue)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-muted)";
                  }}
                  onClick={() => runCommand(preset.cmd)}
                  title={`Run: ${preset.cmd}`}
                >
                  <PlayIcon />
                  {preset.label}
                </button>
              )}
            </For>
            {/* Custom command input */}
            <div class="flex items-center gap-1 flex-1 min-w-[100px]">
              <input
                type="text"
                class="flex-1 text-xs rounded px-1.5 py-0.5 outline-none min-w-0"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-muted)",
                }}
                placeholder="custom cmd..."
                value={customCmd()}
                onInput={(e) => setCustomCmd(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customCmd().trim()) {
                    runCommand(customCmd().trim());
                    setCustomCmd("");
                  }
                }}
              />
              <Show when={isRunning()}>
                <button
                  class="flex items-center justify-center rounded px-1.5 py-0.5 text-xs"
                  style={{
                    background: "var(--accent-red)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  onClick={stopProcess}
                  title="Stop process (Ctrl+C)"
                >
                  <StopIcon />
                </button>
              </Show>
            </div>
          </div>

          {/* Mini terminal */}
          <div
            ref={terminalContainerRef}
            class="shrink-0 overflow-hidden"
            style={{
              height: "140px",
              "min-height": "80px",
              padding: "2px 0 0 4px",
              background: "var(--bg-base)",
              "border-bottom": "1px solid var(--border-muted)",
            }}
          />

          {/* URL bar */}
          <div
            class="flex items-center gap-1 shrink-0 px-2 py-1"
            style={{ "border-bottom": "1px solid var(--border-muted)" }}
          >
            <span class="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            <input
              type="text"
              class="flex-1 text-xs rounded px-1.5 py-0.5 outline-none min-w-0"
              style={{
                background: "var(--bg-base)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-muted)",
              }}
              placeholder="http://localhost:3000"
              value={urlInput()}
              onInput={(e) => setUrlInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigateToUrl();
              }}
            />
            <button
              class="flex items-center justify-center rounded shrink-0"
              style={{
                width: "22px",
                height: "22px",
                color: "var(--text-muted)",
                background: "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
              onClick={() => {
                setIframeKey((k) => k + 1);
              }}
              title="Refresh preview"
            >
              <RefreshIcon />
            </button>
          </div>

          {/* Browser iframe */}
          <div class="flex-1 min-h-0 overflow-hidden" style={{ background: "var(--bg-base)" }}>
            <Show
              when={previewUrl()}
              fallback={
                <div class="flex items-center justify-center h-full">
                  <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                    Run a dev server to preview your app
                  </p>
                </div>
              }
            >
              <iframe
                src={`${previewUrl()}${previewUrl().includes("?") ? "&" : "?"}_r=${iframeKey()}`}
                class="w-full h-full border-0"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                title="Dev Preview"
              />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default DevPreviewPanel;
