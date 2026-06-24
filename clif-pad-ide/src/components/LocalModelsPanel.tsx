import { Component, For, Show, onMount } from "solid-js";
import {
  hardware,
  catalog,
  loading,
  error,
  progress,
  refresh,
  download,
  remove,
  setActive,
} from "../stores/localModelsStore";
import type { CatalogEntry, Fit } from "../types/localModels";

const FIT_COLOR: Record<Fit, string> = {
  comfortable: "#22c55e",
  good: "var(--accent-primary)",
  slow: "#f59e0b",
  too_large: "var(--text-muted)",
};

const ROLE_LABEL: Record<string, string> = {
  agentic: "Agentic",
  reasoning: "Reasoning",
  general: "General",
  autocomplete: "Autocomplete",
};

const Badge: Component<{ color: string; bg?: string; children: any }> = (p) => (
  <span
    class="inline-flex items-center rounded-full"
    style={{
      "font-size": "10px",
      "font-weight": "600",
      padding: "1px 8px",
      color: p.color,
      background: p.bg ?? "color-mix(in srgb, currentColor 14%, transparent)",
      border: `1px solid color-mix(in srgb, ${p.color} 32%, transparent)`,
      "letter-spacing": "0.02em",
    }}
  >
    {p.children}
  </span>
);

const ModelCard: Component<{ entry: CatalogEntry }> = (props) => {
  const e = () => props.entry;
  const pct = () => progress()[e().id];
  const isDownloading = () => pct() !== undefined;
  const fitColor = () => FIT_COLOR[e().fit];

  return (
    <div
      class="flex flex-col gap-2 rounded-lg"
      style={{
        padding: "12px",
        background: e().active
          ? "color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface))"
          : "var(--bg-surface)",
        border: `1px solid ${
          e().active
            ? "color-mix(in srgb, var(--accent-primary) 40%, transparent)"
            : "var(--border-default)"
        }`,
      }}
    >
      {/* Title row */}
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5 min-w-0">
          <span
            class="truncate"
            style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-primary)" }}
          >
            {e().name}
          </span>
          <span style={{ "font-size": "11px", color: "var(--text-muted)" }}>
            {e().params_b}B · {e().quant} · ~{e().size_gb}GB · {Math.round(e().context / 1024)}K ctx
          </span>
        </div>
        <Badge color={fitColor()}>{e().fit_label}</Badge>
      </div>

      {/* Meta row */}
      <div class="flex items-center gap-1.5 flex-wrap">
        <Badge color="var(--text-muted)">{ROLE_LABEL[e().role] ?? e().role}</Badge>
        <Show when={e().active}>
          <Badge color="var(--accent-primary)">Active</Badge>
        </Show>
        <Show when={e().downloaded && !e().active}>
          <Badge color="#22c55e">Downloaded</Badge>
        </Show>
      </div>

      <p style={{ "font-size": "11px", color: "var(--text-muted)", margin: "0", "line-height": "1.4" }}>
        {e().swe_note}
      </p>

      {/* Actions / progress */}
      <Show
        when={!isDownloading()}
        fallback={
          <div class="flex flex-col gap-1">
            <div
              style={{
                height: "6px",
                "border-radius": "999px",
                background: "var(--bg-hover)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(2, pct() ?? 0)}%`,
                  background: "var(--accent-primary)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
            <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
              Downloading… {(pct() ?? 0).toFixed(0)}%
            </span>
          </div>
        }
      >
        <div class="flex items-center gap-1.5">
          <Show
            when={e().downloaded}
            fallback={
              <ActionButton
                primary
                disabled={e().fit === "too_large"}
                onClick={() => download(e().id)}
              >
                {e().fit === "too_large" ? "Too large for this Mac" : "Download"}
              </ActionButton>
            }
          >
            <Show when={!e().active}>
              <ActionButton primary onClick={() => setActive(e().id)}>
                Set active
              </ActionButton>
            </Show>
            <ActionButton onClick={() => remove(e().id)}>Delete</ActionButton>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const ActionButton: Component<{
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: any;
}> = (p) => (
  <button
    class="rounded-md transition-colors"
    disabled={p.disabled}
    onClick={p.onClick}
    style={{
      "font-size": "11px",
      "font-weight": "600",
      padding: "5px 12px",
      cursor: p.disabled ? "not-allowed" : "pointer",
      opacity: p.disabled ? "0.5" : "1",
      color: p.primary ? "var(--bg-base)" : "var(--text-primary)",
      background: p.primary ? "var(--accent-primary)" : "var(--bg-hover)",
      border: p.primary ? "none" : "1px solid var(--border-default)",
    }}
  >
    {p.children}
  </button>
);

const LocalModelsPanel: Component = () => {
  onMount(() => {
    void refresh();
  });

  return (
    <div
      class="flex flex-col h-full overflow-hidden"
      style={{ background: "var(--bg-base)", "font-size": "var(--ui-font-size)" }}
    >
      {/* Header */}
      <div
        class="flex flex-col gap-1 shrink-0"
        style={{ padding: "12px 14px", "border-bottom": "1px solid var(--border-default)" }}
      >
        <div class="flex items-center justify-between">
          <span style={{ "font-size": "13px", "font-weight": "700", color: "var(--text-primary)" }}>
            Local Models
          </span>
          <button
            class="rounded-md transition-colors"
            onClick={() => void refresh()}
            title="Re-detect hardware and refresh"
            style={{
              "font-size": "11px",
              padding: "3px 9px",
              color: "var(--text-muted)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-default)",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
        <span style={{ "font-size": "11px", color: "var(--text-muted)" }}>
          {hardware()?.summary ?? "Detecting hardware…"}
        </span>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div
          style={{
            margin: "10px 14px 0",
            padding: "8px 10px",
            "border-radius": "8px",
            "font-size": "11px",
            color: "#f87171",
            background: "color-mix(in srgb, #f87171 12%, transparent)",
            border: "1px solid color-mix(in srgb, #f87171 30%, transparent)",
          }}
        >
          {error()}
        </div>
      </Show>

      {/* List */}
      <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2" style={{ padding: "12px 14px" }}>
        <Show
          when={!loading() || catalog().length > 0}
          fallback={
            <span style={{ "font-size": "12px", color: "var(--text-muted)" }}>Loading catalog…</span>
          }
        >
          <For each={catalog()}>{(entry) => <ModelCard entry={entry} />}</For>
        </Show>

        {/* Honest v1 note */}
        <p
          style={{
            "font-size": "10px",
            color: "var(--text-muted)",
            "margin-top": "4px",
            "line-height": "1.5",
            opacity: "0.8",
          }}
        >
          v1: download &amp; manage models. In-process inference (MLX on Mac,
          llama.cpp on Windows/Linux) is the next milestone — selecting a model
          here will route the agent to it once the engine lands.
        </p>
      </div>
    </div>
  );
};

export default LocalModelsPanel;
