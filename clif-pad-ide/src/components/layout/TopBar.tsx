import { Component, Show, For, createSignal, onCleanup } from "solid-js";
import { theme, applyTheme, fontSize, setUiFontSize, THEMES, toggleSidebar, sidebarVisible, toggleLocalModels, localModelsVisible } from "../../stores/uiStore";
import { securityEnabled, setSecurityEnabled } from "../../stores/securityStore";
import type { Theme } from "../../stores/uiStore";
import { settings, updateSettings } from "../../stores/settingsStore";
import { projectRoot } from "../../stores/fileStore";
import { MONO_FONTS, loadGoogleFont, applyUiFont } from "../../lib/fonts";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function getProjectName(): string {
  const root = projectRoot();
  if (!root) return "";
  const parts = root.split("/");
  return parts[parts.length - 1] || "";
}

// ---------------------------------------------------------------------------
// IconButton: narrow button that hides its label below a breakpoint. The
// label is always in the tooltip so keyboard+hover users see what it does.
// Uses a custom `data-label` attribute we can hide via CSS without forcing
// a container query.
// ---------------------------------------------------------------------------

const IconButton: Component<{
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  accent?: string;
  title?: string;
  children: any;
}> = (props) => {
  const bg = () =>
    props.active ? "var(--bg-active)" : "var(--bg-hover)";
  const color = () => {
    if (props.accent) return props.accent;
    if (props.active) return "var(--text-primary)";
    return "var(--text-muted)";
  };
  return (
    <button
      class="topbar-icon-btn flex items-center gap-1.5 rounded-lg transition-all"
      style={{
        padding: "6px 9px",
        background: bg(),
        color: color(),
        border: "1px solid var(--border-default)",
        cursor: "pointer",
        "font-size": "12px",
        "font-weight": "500",
        "white-space": "nowrap",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = bg();
      }}
      title={props.title ?? props.label}
      onClick={props.onClick}
    >
      {props.children}
      <span class="topbar-btn-label">{props.label}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Settings popover — consolidates font size, font family, theme, and the
// security scan toggle. Keeps the top bar lean.
// ---------------------------------------------------------------------------

const SettingsMenu: Component = () => {
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  const outside = (e: MouseEvent) => {
    if (ref && !ref.contains(e.target as Node)) setOpen(false);
  };

  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next) {
      setTimeout(() => document.addEventListener("click", outside), 0);
    } else {
      document.removeEventListener("click", outside);
    }
  };

  onCleanup(() => document.removeEventListener("click", outside));

  const themeKeys = Object.keys(THEMES) as Theme[];
  const darkThemes = () => themeKeys.filter((t) => THEMES[t].isDark);
  const lightThemes = () => themeKeys.filter((t) => !THEMES[t].isDark);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <IconButton
        label="Settings"
        active={open()}
        title="Preferences: fonts, theme, security scan"
        onClick={toggle}
      >
        <GearIcon />
        <ChevronIcon />
      </IconButton>

      <Show when={open()}>
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: "0",
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-default)",
            "border-radius": "12px",
            "box-shadow": "0 12px 40px rgba(0,0,0,0.35)",
            padding: "12px",
            width: "360px",
            "z-index": "200",
            "backdrop-filter": "blur(22px)",
            "-webkit-backdrop-filter": "blur(22px)",
          }}
        >
          {/* Font size row */}
          <SectionLabel>Font size · {fontSize()}px</SectionLabel>
          <div class="flex items-center gap-2" style={{ "margin-bottom": "10px" }}>
            <button
              class="rounded px-2"
              style={{
                border: "1px solid var(--border-default)",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                height: "26px",
                "min-width": "26px",
              }}
              onClick={() => setUiFontSize(Math.max(10, fontSize() - 1))}
              title="Smaller"
            >
              −
            </button>
            <input
              type="range"
              class="font-slider"
              min="10"
              max="24"
              step="1"
              value={fontSize()}
              onInput={(e) => {
                const v = parseInt(e.currentTarget.value);
                setUiFontSize(v);
                updateSettings({ fontSize: v });
              }}
              style={{ flex: "1" }}
            />
            <button
              class="rounded px-2"
              style={{
                border: "1px solid var(--border-default)",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                height: "26px",
                "min-width": "26px",
              }}
              onClick={() => setUiFontSize(Math.min(24, fontSize() + 1))}
              title="Larger"
            >
              +
            </button>
          </div>

          {/* Font family */}
          <SectionLabel>Font</SectionLabel>
          <select
            class="w-full rounded"
            style={{
              background: "var(--bg-hover)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              padding: "6px 8px",
              "margin-bottom": "12px",
              "font-size": "12px",
              cursor: "pointer",
              "font-family": settings().editorFont,
            }}
            value={settings().editorFont}
            onChange={(e) => {
              const font = e.currentTarget.value;
              loadGoogleFont(font);
              applyUiFont(font);
              updateSettings({ editorFont: font, terminalFont: font, uiFont: font });
            }}
          >
            <For each={MONO_FONTS}>{(f) => <option value={f.value}>{f.label}</option>}</For>
          </select>

          {/* Themes */}
          <SectionLabel>Theme</SectionLabel>
          <ThemeGrid themes={darkThemes()} heading="Dark" />
          <ThemeGrid themes={lightThemes()} heading="Light" />

          {/* Security toggle */}
          <div
            style={{
              "margin-top": "10px",
              "padding-top": "10px",
              "border-top": "1px solid var(--border-muted)",
            }}
          >
            <button
              class="w-full flex items-center justify-between rounded-lg px-3 py-2 transition-colors"
              style={{
                background: "var(--bg-hover)",
                border: "1px solid var(--border-default)",
                color: securityEnabled() ? "var(--accent-green)" : "var(--text-secondary)",
                cursor: "pointer",
                "font-size": "12px",
                "font-weight": "500",
              }}
              onClick={() => setSecurityEnabled(!securityEnabled())}
              title={
                securityEnabled()
                  ? "Security scan is ON — click to disable"
                  : "Security scan is OFF — click to enable"
              }
            >
              <span class="flex items-center gap-2">
                <ShieldIcon />
                Security scan
              </span>
              <span
                class="rounded-full px-2 py-0.5"
                style={{
                  background: securityEnabled() ? "var(--accent-green)" : "var(--bg-active)",
                  color: securityEnabled() ? "#fff" : "var(--text-muted)",
                  "font-size": "10px",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                }}
              >
                {securityEnabled() ? "On" : "Off"}
              </span>
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

const SectionLabel: Component<{ children: any }> = (p) => (
  <div
    style={{
      "font-size": "10px",
      "font-weight": "600",
      color: "var(--text-muted)",
      "text-transform": "uppercase",
      "letter-spacing": "0.06em",
      "margin-bottom": "6px",
    }}
  >
    {p.children}
  </div>
);

const ThemeGrid: Component<{ themes: Theme[]; heading: string }> = (p) => {
  return (
    <div style={{ "margin-bottom": "8px" }}>
      <div
        style={{
          "font-size": "9px",
          color: "var(--text-muted)",
          opacity: 0.7,
          "margin-bottom": "4px",
        }}
      >
        {p.heading}
      </div>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "4px" }}>
        <For each={p.themes}>
          {(t) => {
            const meta = THEMES[t];
            const isActive = () => theme() === t;
            return (
              <button
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                style={{
                  background: isActive() ? "var(--bg-active)" : "transparent",
                  border: isActive()
                    ? `1px solid ${meta.accent}66`
                    : "1px solid transparent",
                  cursor: "pointer",
                  "text-align": "left",
                  "min-width": "0",
                }}
                onMouseEnter={(e) => {
                  if (!isActive())
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive())
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
                onClick={() => {
                  applyTheme(t);
                  updateSettings({ theme: t });
                }}
              >
                <div
                  style={{
                    width: "22px",
                    height: "16px",
                    "border-radius": "3px",
                    background: meta.bg,
                    border: "1px solid rgba(255,255,255,0.1)",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "flex-shrink": "0",
                  }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "2px",
                      "border-radius": "1px",
                      background: meta.accent,
                    }}
                  />
                </div>
                <span
                  class="truncate"
                  style={{
                    "font-size": "11px",
                    color: isActive() ? meta.accent : "var(--text-secondary)",
                    "font-weight": isActive() ? "600" : "400",
                    flex: "1",
                    "min-width": "0",
                  }}
                >
                  {meta.label}
                </span>
                <Show when={isActive()}>
                  <CheckIcon />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

const TopBar: Component<{
  onOpenFolder: () => void;
  onOpenBrowser: () => void;
}> = (props) => {
  return (
    <div
      class="flex items-center shrink-0 select-none"
      style={{
        height: "44px",
        background: "color-mix(in srgb, var(--bg-surface) 80%, transparent)",
        "backdrop-filter": `blur(var(--surface-blur))`,
        "-webkit-backdrop-filter": `blur(var(--surface-blur))`,
        "border-bottom": "1px solid var(--border-muted)",
        "padding-right": "10px",
        position: "relative",
        "z-index": "100",
      }}
    >
      {/* macOS traffic light zone — draggable. Tightened from 78px → 70px so
          the logo sits snugger against the window controls. 70px covers the
          three traffic-light circles with a comfortable right gutter. */}
      <div data-tauri-drag-region style={{ width: "70px", height: "44px", "flex-shrink": "0" }} />

      {/* Logo + ClifCode + project name + mode toggle */}
      <div
        class="flex items-center gap-2 min-w-0"
        style={{ "flex-shrink": "1", "margin-right": "10px" }}
      >
        <div
          style={{
            width: "30px",
            height: "22px",
            background: "var(--accent-primary)",
            "border-radius": "5px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-family": '"Fira Code", "JetBrains Mono", "SF Mono", monospace',
            "font-size": "14px",
            "font-weight": "900",
            color: "var(--accent-text, #fff)",
            "letter-spacing": "-1px",
            "flex-shrink": "0",
          }}
        >
          {"< >"}
        </div>
        <span
          class="topbar-brand text-sm font-semibold"
          style={{ color: "var(--text-primary)", "white-space": "nowrap" }}
        >
          ClifCode
        </span>
        <Show when={getProjectName()}>
          <div
            class="topbar-divider"
            style={{ width: "1px", height: "14px", background: "var(--border-default)", opacity: "0.6" }}
          />
          <span
            class="topbar-project text-sm truncate"
            style={{
              color: "var(--text-muted)",
              "max-width": "160px",
              "min-width": "0",
              "white-space": "nowrap",
            }}
            title={projectRoot() ?? ""}
          >
            {getProjectName()}
          </span>
        </Show>
      </div>

      {/* Draggable spacer */}
      <div data-tauri-drag-region class="flex-1 h-full" style={{ "min-width": "0" }} />

      {/* Right controls — minimal, icons with labels that collapse on narrow widths */}
      <div class="flex items-center gap-1.5">
        <IconButton
          label="Browser"
          onClick={() => props.onOpenBrowser()}
          title="Open browser tab"
        >
          <GlobeIcon />
        </IconButton>

        <IconButton
          label={sidebarVisible() ? "Files" : "Files"}
          active={sidebarVisible()}
          onClick={() => toggleSidebar()}
          title={sidebarVisible() ? "Hide Git/Files panel" : "Show Git/Files panel"}
        >
          <FolderIcon />
        </IconButton>

        <IconButton
          label="Models"
          active={localModelsVisible()}
          onClick={() => toggleLocalModels()}
          title={localModelsVisible() ? "Hide Local Models" : "Show Local Models"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        </IconButton>

        <SettingsMenu />
      </div>

      {/*
        Scoped CSS:
        - Hide button text labels under 900px so icons remain visible
        - Hide project name and brand text under 720px
      */}
      <style>{`
        @media (max-width: 900px) {
          .topbar-icon-btn .topbar-btn-label { display: none; }
        }
        @media (max-width: 720px) {
          .topbar-project { display: none !important; }
          .topbar-divider { display: none !important; }
        }
        @media (max-width: 560px) {
          .topbar-brand { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default TopBar;
