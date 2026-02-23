import { Component, onMount, onCleanup, createSignal, createEffect } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, onPtyOutput, onPtyExit } from "../../lib/tauri";
import { theme, fontSize } from "../../stores/uiStore";
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
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
  graphite: {
    background: "#1c1c1e",
    foreground: "#f5f5f7",
    cursor: "#f0883e",
    cursorAccent: "#1c1c1e",
    selectionBackground: "rgba(240, 136, 62, 0.3)",
    black: "#48484a",
    red: "#ff453a",
    green: "#30d158",
    yellow: "#ffd60a",
    blue: "#64d2ff",
    magenta: "#bf5af2",
    cyan: "#5ac8fa",
    white: "#d1d1d6",
    brightBlack: "#8e8e93",
    brightRed: "#ff6961",
    brightGreen: "#4cd964",
    brightYellow: "#ffe066",
    brightBlue: "#70d7ff",
    brightMagenta: "#da8fff",
    brightCyan: "#70d7ff",
    brightWhite: "#f5f5f7",
  },
  dawn: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0066cc",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 102, 204, 0.2)",
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#2da44e",
    brightYellow: "#bf8700",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
  arctic: {
    background: "#f0f4f8",
    foreground: "#0f172a",
    cursor: "#0284c7",
    cursorAccent: "#f0f4f8",
    selectionBackground: "rgba(2, 132, 199, 0.2)",
    black: "#334155",
    red: "#dc2626",
    green: "#059669",
    yellow: "#d97706",
    blue: "#0284c7",
    magenta: "#7c3aed",
    cyan: "#0891b2",
    white: "#64748b",
    brightBlack: "#475569",
    brightRed: "#ef4444",
    brightGreen: "#10b981",
    brightYellow: "#f59e0b",
    brightBlue: "#0ea5e9",
    brightMagenta: "#8b5cf6",
    brightCyan: "#06b6d4",
    brightWhite: "#94a3b8",
  },
  dusk: {
    background: "#1a1625",
    foreground: "#ede9fe",
    cursor: "#a855f7",
    cursorAccent: "#1a1625",
    selectionBackground: "rgba(168, 85, 247, 0.3)",
    black: "#372f48",
    red: "#fb7185",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#818cf8",
    magenta: "#c084fc",
    cyan: "#67e8f9",
    white: "#a78bfa",
    brightBlack: "#7c6ba0",
    brightRed: "#fda4af",
    brightGreen: "#6ee7b7",
    brightYellow: "#fde68a",
    brightBlue: "#a5b4fc",
    brightMagenta: "#d8b4fe",
    brightCyan: "#a5f3fc",
    brightWhite: "#ede9fe",
  },
};

export interface TerminalPanelRef {
  sendCommand: (cmd: string) => void;
}

const TerminalPanel: Component<{ ref?: (ref: TerminalPanelRef) => void; workingDir?: string }> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  let unlistenOutput: UnlistenFn | undefined;
  let unlistenExit: UnlistenFn | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let dataDisposable: { dispose: () => void } | undefined;
  let alive = true;

  const sendCommand = (cmd: string) => {
    const sid = sessionId();
    if (sid) {
      ptyWrite(sid, cmd);
    }
  };

  async function spawnSession(workingDir?: string) {
    if (!terminal || !fitAddon) return;

    unlistenOutput?.();
    unlistenExit?.();
    dataDisposable?.dispose();

    try {
      const sid = await ptySpawn(workingDir);
      setSessionId(sid);

      unlistenOutput = await onPtyOutput((event) => {
        if (event.session_id === sid && event.data) {
          terminal?.write(event.data);
        }
      });

      unlistenExit = await onPtyExit((event) => {
        if (event.session_id === sid && alive) {
          terminal?.write("\r\n\x1b[33m[Session ended — restarting shell...]\x1b[0m\r\n\r\n");
          setTimeout(() => {
            if (alive) spawnSession(workingDir);
          }, 500);
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
      terminal?.write(`\r\n\x1b[31mFailed to start terminal: ${e}\x1b[0m\r\n`);
    }
  }

  onMount(async () => {
    props.ref?.({ sendCommand });

    const t = theme();
    terminal = new Terminal({
      fontSize: fontSize(),
      fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10000,
      theme: terminalThemes[t],
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef);

    requestAnimationFrame(() => {
      fitAddon?.fit();
    });

    await spawnSession(props.workingDir);

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
    resizeObserver.observe(containerRef);
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
      terminal.options.fontSize = size;
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
    <div
      ref={containerRef}
      class="w-full h-full overflow-hidden"
      style={{
        padding: "4px 0 0 8px",
        background: "var(--bg-base)",
      }}
    />
  );
};

export default TerminalPanel;
