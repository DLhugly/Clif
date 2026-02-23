import { Component, onMount, Show, createSignal, lazy, Suspense } from "solid-js";
import TopBar from "./components/layout/TopBar";
import EditorArea from "./components/layout/EditorArea";
import StatusBar from "./components/layout/StatusBar";
import RightSidebar from "./components/layout/RightSidebar";
import { terminalWidth, setTerminalWidth, terminalVisible, sidebarVisible, sidebarWidth, setSidebarWidth, applyTheme, setUiFontSize, toggleTerminal, toggleSidebar, setShowCommandPalette } from "./stores/uiStore";
import { loadSettings, settings } from "./stores/settingsStore";
import { registerKeybinding, initKeybindings } from "./lib/keybindings";
import { saveActiveFile, projectRoot, openProject } from "./stores/fileStore";
import { initGit } from "./stores/gitStore";
import { configureMonaco } from "./lib/monaco-setup";
import type { TerminalPanelRef } from "./components/terminal/TerminalPanel";

const TerminalPanel = lazy(() => import("./components/terminal/TerminalPanel"));

const App: Component = () => {
  let terminalRef: TerminalPanelRef | undefined;
  const [isDraggingTerminal, setIsDraggingTerminal] = createSignal(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = createSignal(false);

  function handleLaunchClaude() {
    if (terminalRef && projectRoot()) {
      terminalRef.sendCommand("claude\n");
    }
  }

  async function handleOpenFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Folder",
      });
      if (selected && typeof selected === "string") {
        await openProject(selected);
        if (terminalRef) {
          terminalRef.sendCommand(`cd ${JSON.stringify(selected)}\n`);
        }
        await initGit();
      }
    } catch {
      console.warn("Tauri dialog plugin not available");
    }
  }

  function handleTerminalResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingTerminal(true);

    const onMouseMove = (e: MouseEvent) => {
      const sidebarPx = sidebarVisible() ? sidebarWidth() : 0;
      const availableWidth = window.innerWidth - sidebarPx;
      const pct = (e.clientX / availableWidth) * 100;
      setTerminalWidth(Math.max(20, Math.min(80, pct)));
    };

    const onMouseUp = () => {
      setIsDraggingTerminal(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingSidebar(true);

    const onMouseMove = (e: MouseEvent) => {
      const width = window.innerWidth - e.clientX;
      setSidebarWidth(Math.max(180, Math.min(500, width)));
    };

    const onMouseUp = () => {
      setIsDraggingSidebar(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  onMount(async () => {
    configureMonaco();

    await loadSettings();
    const s = settings();
    applyTheme(s.theme);
    setUiFontSize(s.fontSize);

    registerKeybinding("s", ["ctrl"], saveActiveFile, "Save file");
    registerKeybinding("`", ["ctrl"], toggleTerminal, "Toggle terminal");
    registerKeybinding("b", ["ctrl"], toggleSidebar, "Toggle sidebar");
    registerKeybinding("p", ["ctrl", "shift"], () => setShowCommandPalette(true), "Command palette");

    initKeybindings();
  });

  return (
    <div
      class="flex flex-col w-full h-screen overflow-hidden"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      {/* Top Bar */}
      <TopBar onLaunchClaude={handleLaunchClaude} onOpenFolder={handleOpenFolder} />

      {/* Main content: Terminal (left) + Editor (center) + Sidebar (right) */}
      <div class="flex flex-1 min-h-0">
        {/* Terminal Panel */}
        <Show when={terminalVisible()}>
          <div
            style={{ width: `${terminalWidth()}%` }}
            class="h-full min-w-0 shrink-0"
          >
            <Suspense
              fallback={
                <div
                  class="flex items-center justify-center h-full"
                  style={{ color: "var(--text-muted)", background: "var(--bg-base)" }}
                >
                  <span class="text-sm">Starting terminal...</span>
                </div>
              }
            >
              <TerminalPanel ref={(r) => (terminalRef = r)} />
            </Suspense>
          </div>

          {/* Terminal Resize Handle */}
          <div
            class="shrink-0 cursor-col-resize"
            style={{
              width: "5px",
              background: isDraggingTerminal() ? "var(--accent-primary)" : "var(--border-default)",
              transition: isDraggingTerminal() ? "none" : "background 0.15s",
            }}
            onMouseDown={handleTerminalResize}
            onMouseEnter={(e) => {
              if (!isDraggingTerminal()) {
                (e.currentTarget as HTMLElement).style.background = "var(--accent-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isDraggingTerminal()) {
                (e.currentTarget as HTMLElement).style.background = "var(--border-default)";
              }
            }}
          />
        </Show>

        {/* Editor Panel */}
        <div class="flex-1 min-w-0 h-full">
          <EditorArea />
        </div>

        {/* Right Sidebar */}
        <Show when={sidebarVisible()}>
          {/* Sidebar Resize Handle */}
          <div
            class="shrink-0 cursor-col-resize"
            style={{
              width: "5px",
              background: isDraggingSidebar() ? "var(--accent-primary)" : "var(--border-default)",
              transition: isDraggingSidebar() ? "none" : "background 0.15s",
            }}
            onMouseDown={handleSidebarResize}
            onMouseEnter={(e) => {
              if (!isDraggingSidebar()) {
                (e.currentTarget as HTMLElement).style.background = "var(--accent-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isDraggingSidebar()) {
                (e.currentTarget as HTMLElement).style.background = "var(--border-default)";
              }
            }}
          />

          <div
            style={{ width: `${sidebarWidth()}px` }}
            class="h-full shrink-0"
          >
            <RightSidebar onOpenFolder={handleOpenFolder} />
          </div>
        </Show>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
};

export default App;
