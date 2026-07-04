import { Component, For, Show, createSignal, onMount, onCleanup, createMemo } from "solid-js";
import { settings, updateSettings } from "../../stores/settingsStore";
import { discovered, scanExisting } from "../../stores/localModelsStore";
import { toggleLocalModels } from "../../stores/uiStore";
import { POPULAR_MODELS } from "../agent/constants";
import type { OpenRouterModel } from "../agent/constants";
import type { DiscoverySource } from "../../types/localModels";

// All discovered GGUF files run in Clif's OWN embedded engine (llama.cpp) — no
// external server. We just need the file path; the source is only a label.
const SOURCE_LABEL: Record<DiscoverySource, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  huggingface: "HF cache",
  clif: "Clif",
};

const PROVIDER_DOT: Record<string, string> = {
  openrouter: "#a855f7",
  local: "#22c55e",
};

const UnifiedModelSelector: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [orModels, setOrModels] = createSignal<OpenRouterModel[]>([]);
  const [search, setSearch] = createSignal("");
  let root: HTMLDivElement | undefined;

  const currentProvider = () => settings().aiProvider || "openrouter";
  // Local models are stored as a full path — show just the filename.
  const currentModel = () => {
    const m = settings().aiModel;
    if (!m) return "Select model";
    if (currentProvider() === "local") {
      const base = m.split("/").pop() || m;
      return base.replace(/\.gguf$/i, "");
    }
    return m;
  };

  async function fetchOpenRouter() {
    if (orModels().length > 0) return;
    try {
      const resp = await fetch(
        "https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text",
      );
      if (!resp.ok) return;
      const data = await resp.json();
      setOrModels((data.data || []).filter((m: OpenRouterModel) => m.id && !m.id.includes(":free")));
    } catch {
      /* fall back to static list */
    }
  }

  function openPopover() {
    setOpen(true);
    void scanExisting();
    void fetchOpenRouter();
  }

  function pick(provider: string, model: string) {
    void updateSettings({ aiProvider: provider, aiModel: model });
    setOpen(false);
  }

  const cloudModels = createMemo(() => {
    const q = search().toLowerCase();
    const base =
      orModels().length > 0
        ? orModels()
        : (POPULAR_MODELS.openrouter || []).map((m) => ({ id: m.value, name: m.label }) as OpenRouterModel);
    return q
      ? base.filter((m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q))
      : base.slice(0, 40);
  });

  // Every discovered GGUF is runnable in the embedded engine.
  const localModels = createMemo(() => discovered());

  const onDocClick = (e: MouseEvent) => {
    if (root && !root.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => document.addEventListener("click", onDocClick));
  onCleanup(() => document.removeEventListener("click", onDocClick));

  return (
    <div ref={root} class="relative flex items-center">
      {/* Trigger */}
      <button
        class="flex items-center gap-1.5 rounded-md transition-colors"
        onClick={(e) => { e.stopPropagation(); open() ? setOpen(false) : openPopover(); }}
        title="Select model — cloud (OpenRouter) or local"
        style={{
          height: "24px",
          padding: "0 9px",
          "font-size": "11px",
          "font-weight": "600",
          color: "var(--text-primary)",
          background: "var(--bg-hover)",
          border: "1px solid var(--border-default)",
        }}
      >
        <span style={{ width: "7px", height: "7px", "border-radius": "999px", background: PROVIDER_DOT[currentProvider()] ?? "var(--text-muted)" }} />
        <span style={{ "max-width": "180px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {currentModel()}
        </span>
        <span style={{ color: "var(--text-muted)", "font-size": "9px" }}>▾</span>
      </button>

      {/* Popover */}
      <Show when={open()}>
        <div
          class="absolute rounded-lg overflow-hidden flex flex-col"
          style={{
            top: "30px",
            left: "0",
            width: "340px",
            "max-height": "460px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            "box-shadow": "0 12px 32px rgba(0,0,0,0.35)",
            "z-index": "1000",
          }}
        >
          <div class="flex flex-col overflow-y-auto" style={{ padding: "6px" }}>
            {/* LOCAL */}
            <div class="flex items-center justify-between" style={{ padding: "6px 8px 4px" }}>
              <span style={{ "font-size": "10px", "font-weight": "700", color: "var(--text-muted)", "letter-spacing": "0.04em" }}>
                LOCAL — ON YOUR MACHINE
              </span>
              <button
                onClick={() => { setOpen(false); toggleLocalModels(); }}
                style={{ "font-size": "10px", color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}
              >
                Manage →
              </button>
            </div>
            <Show
              when={localModels().length > 0}
              fallback={
                <div style={{ padding: "6px 8px 10px", "font-size": "11px", color: "var(--text-muted)", "line-height": "1.5" }}>
                  No local models found. Download one in Manage — it runs in Clif's
                  built-in engine, no external app needed.
                </div>
              }
            >
              <For each={localModels()}>
                {(d) => {
                  const active = () => currentProvider() === "local" && settings().aiModel === d.path;
                  return (
                    <button
                      class="flex items-center justify-between gap-2 rounded-md transition-colors"
                      onClick={() => pick("local", d.path)}
                      style={{
                        padding: "7px 8px", width: "100%", cursor: "pointer", "text-align": "left",
                        background: active() ? "color-mix(in srgb, var(--accent-primary) 12%, transparent)" : "transparent",
                        border: "none",
                      }}
                    >
                      <span class="flex items-center gap-2 min-w-0">
                        <span style={{ width: "7px", height: "7px", "border-radius": "999px", background: PROVIDER_DOT.local }} />
                        <span class="truncate" style={{ "font-size": "12px", color: "var(--text-primary)", "font-weight": active() ? "700" : "500" }}>{d.name}</span>
                      </span>
                      <span style={{ "font-size": "9px", color: "var(--text-muted)", "white-space": "nowrap" }}>{SOURCE_LABEL[d.source]}</span>
                    </button>
                  );
                }}
              </For>
            </Show>

            {/* CLOUD */}
            <span style={{ padding: "10px 8px 4px", "font-size": "10px", "font-weight": "700", color: "var(--text-muted)", "letter-spacing": "0.04em" }}>
              CLOUD — OPENROUTER
            </span>
            <input
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search models…"
              style={{
                margin: "0 6px 6px", padding: "6px 9px", "font-size": "11px",
                background: "var(--bg-base)", border: "1px solid var(--border-default)",
                "border-radius": "6px", color: "var(--text-primary)", outline: "none",
              }}
            />
            <For each={cloudModels()}>
              {(m) => {
                const active = () => currentProvider() === "openrouter" && settings().aiModel === m.id;
                return (
                  <button
                    class="flex items-center gap-2 rounded-md transition-colors"
                    onClick={() => pick("openrouter", m.id)}
                    style={{
                      padding: "7px 8px", width: "100%", cursor: "pointer", "text-align": "left",
                      background: active() ? "color-mix(in srgb, var(--accent-primary) 12%, transparent)" : "transparent",
                      border: "none",
                    }}
                  >
                    <span style={{ width: "7px", height: "7px", "border-radius": "999px", background: PROVIDER_DOT.openrouter }} />
                    <span class="truncate" style={{ "font-size": "12px", color: "var(--text-primary)", "font-weight": active() ? "700" : "500" }}>
                      {m.name || m.id}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default UnifiedModelSelector;
