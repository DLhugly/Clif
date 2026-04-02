import { createSignal, createEffect } from "solid-js";

export type Theme = "midnight" | "graphite" | "dawn" | "arctic" | "dusk" | "cyberpunk" | "ember" | "forest" | "solarized-dark" | "monokai" | "nord" | "dracula" | "one-dark" | "tokyo-night" | "catppuccin" | "rose-pine" | "ayu-dark" | "vesper" | "poimandres" | "pale-fire";

export type Panel = "terminal" | "agent" | "files" | "editor";

export interface ThemeMeta {
  label: string;
  accent: string;
  bg: string;
  isDark: boolean;
}

export const THEMES: Record<Theme, ThemeMeta> = {
  midnight:          { label: "Midnight",        accent: "#3b82f6", bg: "#0d1117", isDark: true },
  graphite:          { label: "Graphite",         accent: "#f0883e", bg: "#1c1c1e", isDark: true },
  dawn:              { label: "Dawn",             accent: "#0066cc", bg: "#ffffff", isDark: false },
  arctic:            { label: "Arctic",           accent: "#0284c7", bg: "#f0f4f8", isDark: false },
  dusk:              { label: "Dusk",             accent: "#a855f7", bg: "#1a1625", isDark: true },
  cyberpunk:         { label: "Cyberpunk",        accent: "#ff0090", bg: "#0d0015", isDark: true },
  ember:             { label: "Ember",            accent: "#f97316", bg: "#1a1210", isDark: true },
  forest:            { label: "Forest",           accent: "#22c55e", bg: "#0f1a0f", isDark: true },
  "solarized-dark":  { label: "Solarized Dark",   accent: "#268bd2", bg: "#002b36", isDark: true },
  monokai:           { label: "Monokai",          accent: "#a6e22e", bg: "#272822", isDark: true },
  nord:              { label: "Nord",             accent: "#88c0d0", bg: "#2e3440", isDark: true },
  dracula:           { label: "Dracula",          accent: "#bd93f9", bg: "#282a36", isDark: true },
  "one-dark":        { label: "One Dark",         accent: "#61afef", bg: "#282c34", isDark: true },
  "tokyo-night":     { label: "Tokyo Night",      accent: "#7aa2f7", bg: "#1a1b26", isDark: true },
  catppuccin:        { label: "Catppuccin",        accent: "#cba6f7", bg: "#1e1e2e", isDark: true },
  "rose-pine":       { label: "Rosé Pine",        accent: "#ebbcba", bg: "#191724", isDark: true },
  "ayu-dark":        { label: "Ayu Dark",         accent: "#ffb454", bg: "#0a0e14", isDark: true },
  vesper:            { label: "Vesper",            accent: "#ffc799", bg: "#101010", isDark: true },
  poimandres:        { label: "Poimandres",        accent: "#a6accd", bg: "#1b1e28", isDark: true },
  "pale-fire":       { label: "Pale Fire",        accent: "#b4637a", bg: "#faf4ed", isDark: false },
};

// Panel visibility — single source of truth
const [visiblePanels, setVisiblePanels] = createSignal<Set<Panel>>(new Set(["files", "editor"]));

// Panel sizes
const [terminalHeight, setTerminalHeight] = createSignal(30);
const [sidebarWidth, setSidebarWidth] = createSignal(240);
const [agentWidth, setAgentWidth] = createSignal(380);

// Clamp panel width to ensure it doesn't push other panels off screen
export function clampPanelWidth(
  panelWidth: number,
  panelType: "sidebar" | "agent",
  windowWidth: number,
  otherPanelWidth: number
): number {
  const minWidth = 200;
  // Allow panels to expand flexibly based on window size
  // Agent: up to 70% for reading responses
  // Sidebar: up to 50% for file tree / git views
  const maxPercentOfWindow = panelType === "agent" ? 0.7 : 0.5;
  const calculatedMax = Math.floor(windowWidth * maxPercentOfWindow);

  // Calculate available space (reserve 200px for editor minimum)
  const availableWidth = windowWidth - 200;
  const maxAllowedWidth = Math.min(calculatedMax, availableWidth - otherPanelWidth);

  return Math.max(minWidth, Math.min(panelWidth, maxAllowedWidth));
}

// UI state
const [theme, setTheme] = createSignal<Theme>("midnight");
const [fontSize, setFontSize] = createSignal(14);
const [showCommandPalette, setShowCommandPalette] = createSignal(false);
const [devDrawerOpen, setDevDrawerOpen] = createSignal(false);
const [devDrawerHeight, setDevDrawerHeight] = createSignal(50);

// ClifForge mode — spatial canvas replaces the entire editor area
const [forgeMode, setForgeMode] = createSignal(false);

function toggleForgeMode() {
  setForgeMode(prev => !prev);
}

// Derived visibility signals for backward compatibility
const terminalVisible = () => visiblePanels().has("terminal");
const agentVisible = () => visiblePanels().has("agent");
const sidebarVisible = () => visiblePanels().has("files");
const editorVisible = () => visiblePanels().has("editor");

// Helper functions to toggle panels
function togglePanel(panel: Panel) {
  setVisiblePanels(prev => {
    const next = new Set(prev);
    if (next.has(panel)) {
      next.delete(panel);
    } else {
      next.add(panel);
    }
    return next;
  });
}

function showPanel(panel: Panel) {
  setVisiblePanels(prev => {
    const next = new Set(prev);
    next.add(panel);
    return next;
  });
}

function hidePanel(panel: Panel) {
  setVisiblePanels(prev => {
    const next = new Set(prev);
    next.delete(panel);
    return next;
  });
}

function setPanelVisibility(panels: Panel[]) {
  setVisiblePanels(new Set(panels));
}

const VALID_THEMES = Object.keys(THEMES) as Theme[];

function isValidTheme(t: string): t is Theme {
  return VALID_THEMES.includes(t as Theme);
}

function applyTheme(t: string) {
  const valid = isValidTheme(t) ? t : "midnight";
  document.documentElement.setAttribute("data-theme", valid);
  setTheme(valid);
}

function setUiFontSize(size: number) {
  const clamped = Math.max(10, Math.min(24, Math.round(size)));
  setFontSize(clamped);
  document.documentElement.style.setProperty("--ui-font-size", `${clamped}px`);
}

// Backward-compatible toggle functions
function toggleTerminal() {
  togglePanel("terminal");
}

function toggleSidebar() {
  togglePanel("files");
}

function toggleAgentPanel() {
  togglePanel("agent");
}

function toggleEditor() {
  togglePanel("editor");
}

// Backward-compatible setter functions (deprecated, but kept for compatibility)
function setTerminalVisible(visible: boolean) {
  visible ? showPanel("terminal") : hidePanel("terminal");
}

function setSidebarVisible(visible: boolean) {
  visible ? showPanel("files") : hidePanel("files");
}

function setAgentVisible(visible: boolean) {
  visible ? showPanel("agent") : hidePanel("agent");
}

function setEditorVisible(visible: boolean) {
  visible ? showPanel("editor") : hidePanel("editor");
}

export {
  // Panel visibility
  visiblePanels,
  terminalVisible,
  agentVisible,
  sidebarVisible,
  editorVisible,
  togglePanel,
  showPanel,
  hidePanel,
  setPanelVisibility,
  toggleTerminal,
  toggleSidebar,
  toggleAgentPanel,
  toggleEditor,
  setTerminalVisible,
  setSidebarVisible,
  setAgentVisible,
  setEditorVisible,

  // Panel sizes
  terminalHeight,
  setTerminalHeight,
  sidebarWidth,
  setSidebarWidth,
  agentWidth,
  setAgentWidth,

  // Theme
  theme,
  setTheme,
  applyTheme,

  // Font
  fontSize,
  setUiFontSize,

  // Other UI state
  showCommandPalette,
  setShowCommandPalette,
  devDrawerOpen,
  setDevDrawerOpen,
  devDrawerHeight,
  setDevDrawerHeight,

  // ClifForge
  forgeMode,
  setForgeMode,
  toggleForgeMode,
};
