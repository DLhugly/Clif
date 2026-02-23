import { createSignal } from "solid-js";
import { getSettings, setSettings } from "../lib/tauri";
import type { Theme } from "./uiStore";

interface Settings {
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: "on" | "off";
  minimap: boolean;
  vimMode: boolean;
  aiProvider: string;
  aiModel: string;
}

const defaultSettings: Settings = {
  theme: "midnight",
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  tabSize: 2,
  wordWrap: "off",
  minimap: true,
  vimMode: false,
  aiProvider: "openrouter",
  aiModel: "anthropic/claude-sonnet-4",
};

const [settings, setSettingsLocal] = createSignal<Settings>(defaultSettings);

async function loadSettings() {
  try {
    const s = await getSettings();
    setSettingsLocal({ ...defaultSettings, ...(s as any) });
  } catch {
    // Use defaults
  }
}

async function updateSettings(partial: Partial<Settings>) {
  const updated = { ...settings(), ...partial };
  setSettingsLocal(updated);
  try {
    await setSettings(updated as any);
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

export { settings, loadSettings, updateSettings };
export type { Settings };
