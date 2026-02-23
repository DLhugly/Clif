import { createSignal } from "solid-js";

export type Theme = "midnight" | "graphite" | "dawn" | "arctic" | "dusk";

export interface ThemeMeta {
  label: string;
  accent: string;
  bg: string;
  isDark: boolean;
}

export const THEMES: Record<Theme, ThemeMeta> = {
  midnight: { label: "Midnight", accent: "#3b82f6", bg: "#0d1117", isDark: true },
  graphite: { label: "Graphite", accent: "#f0883e", bg: "#1c1c1e", isDark: true },
  dawn:     { label: "Dawn",     accent: "#0066cc", bg: "#ffffff", isDark: false },
  arctic:   { label: "Arctic",   accent: "#0284c7", bg: "#f0f4f8", isDark: false },
  dusk:     { label: "Dusk",     accent: "#a855f7", bg: "#1a1625", isDark: true },
};

const [terminalWidth, setTerminalWidth] = createSignal(50);
const [terminalVisible, setTerminalVisible] = createSignal(true);
const [sidebarVisible, setSidebarVisible] = createSignal(true);
const [sidebarWidth, setSidebarWidth] = createSignal(240);
const [theme, setTheme] = createSignal<Theme>("midnight");
const [fontSize, setFontSize] = createSignal(14);
const [showCommandPalette, setShowCommandPalette] = createSignal(false);
const [devDrawerOpen, setDevDrawerOpen] = createSignal(false);
const [devDrawerHeight, setDevDrawerHeight] = createSignal(50);

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

function toggleTerminal() {
  setTerminalVisible(!terminalVisible());
}

function toggleSidebar() {
  setSidebarVisible(!sidebarVisible());
}

export {
  terminalWidth,
  setTerminalWidth,
  terminalVisible,
  setTerminalVisible,
  sidebarVisible,
  setSidebarVisible,
  sidebarWidth,
  setSidebarWidth,
  theme,
  setTheme,
  fontSize,
  setUiFontSize,
  showCommandPalette,
  setShowCommandPalette,
  applyTheme,
  toggleTerminal,
  toggleSidebar,
  devDrawerOpen,
  setDevDrawerOpen,
  devDrawerHeight,
  setDevDrawerHeight,
};
