import { Component, Show } from "solid-js";
import { settings } from "../../stores/settingsStore";
import { openRouterModels } from "../../stores/modelBrowserStore";
import { KeyIcon } from "./icons";

interface ProviderModelSelectorProps {
  open: () => boolean;
  setOpen: (v: boolean) => void;
  // Key indicator is optional — the agent panel manages an inline API-key
  // input, other mount points (e.g. the top bar) just need the picker.
  hasApiKey?: () => boolean | null;
  showSettings?: () => boolean;
  setShowSettings?: (v: boolean) => void;
}

/**
 * Compact model chip. Clicking it opens the full ModelBrowser, which lists
 * every runnable model — local (embedded engine) and cloud (OpenRouter) — in
 * one place. No provider toggle here; the browser itself is the only picker.
 */
const ProviderModelSelector: Component<ProviderModelSelectorProps> = (props) => {
  const isLocal = () => settings().aiProvider === "local";

  const currentModelName = () => {
    const current = settings().aiModel;
    if (!current) return "Select model";
    if (isLocal()) {
      const base = current.split("/").pop() || current;
      return base.replace(/\.gguf$/i, "");
    }
    const live = openRouterModels().find((m) => m.id === current);
    const name = live?.name || current;
    return name.replace(/^[^:]+:\s*/, "");
  };

  return (
    <div class="flex items-center shrink-0" style={{ gap: "4px", "min-width": "0" }}>
      {/* Model chip */}
      <button
        class="flex items-center rounded-full transition-colors"
        style={{
          background: props.open() ? "var(--bg-active)" : "var(--bg-hover)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          cursor: "pointer",
          height: "22px",
          padding: "0 3px 0 8px",
          gap: "6px",
          "font-size": "11px",
          "max-width": "200px",
          "min-width": "0",
        }}
        onMouseEnter={(e) => {
          if (!props.open())
            (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
        }}
        onMouseLeave={(e) => {
          if (!props.open())
            (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
        }}
        onClick={() => props.setOpen(!props.open())}
        title={`${currentModelName()} — click to change`}
      >
        <span style={{ width: "7px", height: "7px", "border-radius": "999px", background: isLocal() ? "#22c55e" : "#a855f7", "flex-shrink": "0" }} />
        <span
          class="truncate"
          style={{
            "min-width": "0",
            "font-family": "var(--font-mono, monospace)",
            flex: "1",
          }}
        >
          {currentModelName()}
        </span>
        <span
          class="shrink-0 rounded-full"
          style={{
            background: "color-mix(in srgb, var(--accent-primary) 18%, transparent)",
            color: "var(--accent-primary)",
            padding: "0 6px",
            height: "16px",
            display: "flex",
            "align-items": "center",
            "font-size": "9px",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            "font-weight": "700",
          }}
        >
          {isLocal() ? "Local" : "OpenRouter"}
        </span>
      </button>

      {/* API key indicator — only loud when missing, and only relevant for cloud */}
      <Show when={!isLocal() && props.hasApiKey && props.showSettings && props.setShowSettings}>
        <button
          class="flex items-center justify-center shrink-0 rounded-full transition-colors"
          style={{
            width: "22px",
            height: "22px",
            background: props.hasApiKey!()
              ? "transparent"
              : "color-mix(in srgb, var(--accent-yellow) 20%, transparent)",
            color: props.hasApiKey!() ? "var(--text-muted)" : "var(--accent-yellow)",
            border: `1px solid ${
              props.hasApiKey!()
                ? "var(--border-default)"
                : "color-mix(in srgb, var(--accent-yellow) 45%, transparent)"
            }`,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = props.hasApiKey!()
              ? "transparent"
              : "color-mix(in srgb, var(--accent-yellow) 20%, transparent)";
          }}
          onClick={() => props.setShowSettings!(!props.showSettings!())}
          title={props.hasApiKey!() ? "API key configured — click to change" : "Set API key"}
        >
          <KeyIcon />
        </button>
      </Show>
    </div>
  );
};

export default ProviderModelSelector;
