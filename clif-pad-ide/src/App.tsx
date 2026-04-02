import { Component, onMount, createEffect, Show, createSignal, lazy, Suspense } from "solid-js";
import TopBar from "./components/layout/TopBar";
import EditorArea from "./components/layout/EditorArea";
import StatusBar from "./components/layout/StatusBar";
import RightSidebar from "./components/layout/RightSidebar";
import AboutModal from "./components/layout/AboutModal";
import ToastContainer from "./components/layout/ToastContainer";
import { ResizeHandle } from "./components/ui";
import { terminalHeight, setTerminalHeight, terminalVisible, sidebarVisible, sidebarWidth, setSidebarWidth, agentWidth, setAgentWidth, agentVisible, setAgentVisible, editorVisible, applyTheme, setUiFontSize, toggleTerminal, toggleSidebar, setShowCommandPalette, clampPanelWidth, forgeMode, toggleForgeMode } from "./stores/uiStore";
import { loadSettings, settings } from "./stores/settingsStore";
import { registerKeybinding, initKeybindings } from "./lib/keybindings";
import { saveActiveFile, projectRoot, openProject, openBrowser, togglePreview } from "./stores/fileStore";
import { initGit } from "./stores/gitStore";
import { configureMonaco } from "./lib/monaco-setup";
import { loadGoogleFont, applyUiFont } from "./lib/fonts";
import { createTerminalTab } from "./stores/terminalStore";
import { initAgentListeners } from "./stores/agentStore";
import type { TerminalPanelRef } from "./components/terminal/TerminalPanel";

const TerminalPanel = lazy(() => import("./components/terminal/TerminalPanel"));
const AgentChatPanel = lazy(() => import("./components/agent/AgentChatPanel"));
const ForgeCanvas = lazy(() => import("./components/agent/ForgeCanvas"));

const App: Component = () => {
  let terminalRef: TerminalPanelRef | undefined;
  let sidebarContainerRef: HTMLDivElement | undefined;
  const [isDraggingTerminal, setIsDraggingTerminal] = createSignal(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = createSignal(false);
  const [isDraggingAgent, setIsDraggingAgent] = createSignal(false);
  const [showAbout, setShowAbout] = createSignal(false);
  const isDraggingAny = () => isDraggingTerminal() || isDraggingSidebar() || isDraggingAgent();

  function handleLaunchClaude() {
    if (terminalRef && projectRoot()) {
      terminalRef.sendCommand("claude\n");
    }
  }

  function handleLaunchClifCode() {
    const root = projectRoot();
    if (terminalRef && root) {
      terminalRef.sendCommand(`clifcode -w ${JSON.stringify(root)}\n`);
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
        // Auto-open agent panel when project is opened
        setAgentVisible(true);
      }
    } catch {
      console.warn("Tauri dialog plugin not available");
    }
  }

  function handleTerminalResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingTerminal(true);
    document.body.style.cursor = "row-resize";
    let rafId = 0;

    const onMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const windowHeight = window.innerHeight;
        const statusBarHeight = 24;
        const topBarHeight = 40;
        const availableHeight = windowHeight - statusBarHeight - topBarHeight;
        const pct = ((windowHeight - e.clientY) / availableHeight) * 100;
        setTerminalHeight(Math.max(15, Math.min(70, pct)));
      });
    };

    const onMouseUp = () => {
      cancelAnimationFrame(rafId);
      setIsDraggingTerminal(false);
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
function handleSidebarResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingSidebar(true);
    document.body.style.cursor = "col-resize";
    let rafId = 0;
    // Capture the right edge of the sidebar container at drag start
    const sidebarRight = sidebarContainerRef
      ? sidebarContainerRef.getBoundingClientRect().right
      : window.innerWidth;

    const onMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rawWidth = sidebarRight - e.clientX;
        const otherPanelWidth = agentVisible() ? agentWidth() : 0;
        const width = clampPanelWidth(rawWidth, "sidebar", window.innerWidth, otherPanelWidth);
        setSidebarWidth(width);
      });
    };

    const onMouseUp = () => {
      cancelAnimationFrame(rafId);
      setIsDraggingSidebar(false);
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleAgentResize(e: MouseEvent) {
    e.preventDefault();
    setIsDraggingAgent(true);
    document.body.style.cursor = "col-resize";
    let rafId = 0;

    const onMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rawWidth = window.innerWidth - e.clientX;
        const otherPanelWidth = sidebarVisible() ? sidebarWidth() : 0;
        const width = clampPanelWidth(rawWidth, "agent", window.innerWidth, otherPanelWidth);
        setAgentWidth(width);
      });
    };

    const onMouseUp = () => {
      cancelAnimationFrame(rafId);
      setIsDraggingAgent(false);
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  createEffect(async () => {
    const root = projectRoot();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (root) {
      const folder = root.split("/").pop() || root;
      getCurrentWindow().setTitle(`${folder} — ClifPad`);
    } else {
      getCurrentWindow().setTitle("ClifPad — No folder open");
    }
  });

  onMount(async () => {
    configureMonaco();

    await loadSettings();
    const s = settings();
    applyTheme(s.theme);
    setUiFontSize(s.fontSize);

    // Note: Panel visibility is now managed directly via toggles

    // Load and apply saved fonts
    loadGoogleFont(s.editorFont);
    loadGoogleFont(s.terminalFont);
    loadGoogleFont(s.uiFont);
    applyUiFont(s.uiFont);

    registerKeybinding("s", ["ctrl"], saveActiveFile, "Save file");
    registerKeybinding("`", ["ctrl"], toggleTerminal, "Toggle terminal");
    registerKeybinding("`", ["ctrl", "shift"], () => createTerminalTab(), "New terminal");
    registerKeybinding("k", ["meta"], () => terminalRef?.clearTerminal(), "Clear terminal");
    registerKeybinding("b", ["ctrl"], toggleSidebar, "Toggle sidebar");
    registerKeybinding("p", ["ctrl", "shift"], () => setShowCommandPalette(true), "Command palette");
    registerKeybinding("v", ["ctrl", "shift"], togglePreview, "Toggle markdown preview");
    registerKeybinding("f", ["ctrl", "shift"], toggleForgeMode, "Toggle ClifForge (spatial canvas)");

    initKeybindings();

    // Initialize agent event listeners globally (so they work in both Chat and Forge mode)
    await initAgentListeners();

    // Listen for "About ClifPad" from the system menu
    const { listen } = await import("@tauri-apps/api/event");
    listen("show-about", () => setShowAbout(true));
  });

  return (
    <div
      class="flex flex-col w-full h-screen overflow-hidden"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      {/* Transparent overlay during drag to prevent Monaco/xterm from stealing mouse events */}
      <Show when={isDraggingAny()}>
        <div
          style={{
            position: "fixed",
            inset: "0",
            "z-index": "9999",
            cursor: isDraggingTerminal() ? "row-resize" : "col-resize",
          }}
        />
      </Show>

      {/* Top Bar */}
      <TopBar onOpenFolder={handleOpenFolder} onOpenBrowser={openBrowser} />

      {/* Main content: Editor (with terminal) + Sidebar + Agent — OR ForgeCanvas */}
      <div class="flex flex-1 min-h-0 w-full max-w-full overflow-hidden">
        <Show when={forgeMode()} fallback={
          <>
            {/* Editor Area (with terminal at bottom) */}
            <div class="flex flex-col flex-1 min-h-0 min-w-0">
              {/* Editor Panel (center) */}
              <Show when={editorVisible()}>
                <div class="flex-1 min-w-0 min-h-0">
                  <EditorArea />
                </div>
              </Show>

              {/* Bottom Panel: Terminal (only under editor) */}
              <Show when={terminalVisible()}>
                <ResizeHandle direction="row" isDragging={isDraggingTerminal()} onMouseDown={handleTerminalResize} />

                <div
                  style={{ height: `${terminalHeight()}%` }}
                  class="min-h-0 shrink-0"
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
                    <TerminalPanel
                      ref={(r) => (terminalRef = r)}
                      workingDir={projectRoot() || undefined}
                      onLaunchClifCode={handleLaunchClifCode}
                      onLaunchClaude={handleLaunchClaude}
                    />
                  </Suspense>
                </div>
              </Show>
            </div>

            {/* Right Panel: Sidebar */}
            <Show when={sidebarVisible()}>
              <ResizeHandle direction="col" isDragging={isDraggingSidebar()} onMouseDown={handleSidebarResize} />

              <div
                ref={sidebarContainerRef}
                style={{ width: `${sidebarWidth()}px` }}
                class="h-full shrink-0"
              >
                <RightSidebar onOpenFolder={handleOpenFolder} onOpenRecent={async (path) => {
                  await openProject(path);
                  if (terminalRef) {
                    terminalRef.sendCommand(`cd ${JSON.stringify(path)}\n`);
                  }
                  await initGit();
                }} />
              </div>
            </Show>

            {/* Agent Panel (independent, on the far right) */}
            <Show when={agentVisible()}>
              <ResizeHandle direction="col" isDragging={isDraggingAgent()} onMouseDown={handleAgentResize} />

              <div
                style={{ width: `${agentWidth()}px` }}
                class="h-full shrink-0"
              >
                <Suspense
                  fallback={
                    <div
                      class="flex items-center justify-center h-full"
                      style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
                    >
                      <span class="text-sm">Loading agent...</span>
                    </div>
                  }
                >
                  <AgentChatPanel />
                </Suspense>
              </div>
            </Show>
          </>
        }>
          {/* FORGE MODE: Full-screen spatial canvas replaces everything */}
          <Suspense
            fallback={
              <div
                class="flex items-center justify-center flex-1"
                style={{ color: "var(--text-muted)", background: "#0a0a0f" }}
              >
                <span class="text-sm">Igniting ClifForge...</span>
              </div>
            }
          >
            <ForgeCanvas />
          </Suspense>
        </Show>
      </div>

      {/* Status Bar */}
      <StatusBar onShowAbout={() => setShowAbout(true)} />

      {/* About Modal */}
      <AboutModal open={showAbout()} onClose={() => setShowAbout(false)} />

      {/* Toasts */}
      <ToastContainer />
    </div>
  );
};

export default App;
