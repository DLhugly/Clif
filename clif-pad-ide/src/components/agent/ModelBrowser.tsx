// Full-screen model browser overlay. One list, two sections — Local (embedded
// llama.cpp engine, runs in-process) and Cloud (OpenRouter). No provider tabs:
// picking any entry sets both aiProvider and aiModel in one shot.
import { Component, For, Show, createSignal, onMount } from "solid-js";
import { settings } from "../../stores/settingsStore";
import { fontSize } from "../../stores/uiStore";
import { formatPrice, modelProviderLabel, type OpenRouterModel } from "./constants";
import {
  openRouterModels,
  fetchingModels,
  modelSearch,
  setModelSearch,
  modelSort,
  setModelSort,
  modelProviderFilter,
  setModelProviderFilter,
  fetchOpenRouterModels,
  filteredCloudModels,
} from "../../stores/modelBrowserStore";
import { discovered, scanning, scanExisting } from "../../stores/localModelsStore";
import type { DiscoverySource } from "../../types/localModels";

interface ModelBrowserProps {
  onPick: (provider: string, model: string) => void;
  onClose: () => void;
}

const SOURCE_LABEL: Record<DiscoverySource, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  huggingface: "HF cache",
  clif: "Clif",
};

const ModelBrowser: Component<ModelBrowserProps> = (props) => {
  const [hoveredModel, setHoveredModel] = createSignal<string | null>(null);

  onMount(() => {
    void scanExisting();
    void fetchOpenRouterModels();
  });

  function close() {
    props.onClose();
    setModelSearch("");
  }

  const cloudSearchMatch = () => {
    const q = modelSearch().toLowerCase();
    return (m: { name: string; path?: string }) => !q || m.name.toLowerCase().includes(q);
  };

  const localMatches = () => {
    const match = cloudSearchMatch();
    return discovered().filter((d) => match({ name: d.name }));
  };

  return (
    <div
      style={{
        position: "fixed", inset: "0",
        background: "var(--bg-surface)",
        "z-index": "2000",
        display: "flex", "flex-direction": "column",
      }}
    >
      {/* Browser header */}
      <div
        style={{
          padding: "10px 12px",
          "border-bottom": "1px solid var(--border-default)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <button
          onClick={close}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            "font-size": "18px",
            "line-height": "1",
            padding: "0 4px",
            "flex-shrink": "0",
          }}
          title="Close model browser"
        >
          ←
        </button>

        <input
          type="text"
          placeholder={fetchingModels() ? "Loading models from OpenRouter..." : "Search models..."}
          value={modelSearch()}
          onInput={(e) => setModelSearch(e.currentTarget.value)}
          autofocus
          style={{
            flex: "1",
            background: "var(--bg-base)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-muted)",
            "border-radius": "6px",
            padding: "5px 8px",
            "font-size": "12px",
            outline: "none",
            "font-family": "inherit",
          }}
        />
      </div>

      {/* Sort + filter bar (cloud only) */}
      <div style={{ padding: "6px 10px", "border-bottom": "1px solid var(--border-muted)", display: "flex", gap: "6px", "align-items": "center", "flex-wrap": "wrap" }}>
        <div class="flex items-center gap-1" style={{ "font-size": "10px", color: "var(--text-muted)" }}>
          <span>Sort:</span>
          <For each={[
            { v: "name" as const, label: "A–Z" },
            { v: "price-asc" as const, label: "Cheapest" },
            { v: "price-desc" as const, label: "Priciest" },
            { v: "ctx" as const, label: "Context" },
          ]}>
            {(s) => (
              <button
                onClick={() => setModelSort(s.v)}
                style={{
                  background: modelSort() === s.v ? "var(--accent-primary)" : "var(--bg-hover)",
                  color: modelSort() === s.v ? "#fff" : "var(--text-muted)",
                  border: "none", cursor: "pointer", "font-size": "10px", "font-weight": "600",
                  padding: "2px 7px", "border-radius": "4px",
                }}
              >{s.label}</button>
            )}
          </For>
        </div>

        <div class="flex items-center gap-1 ml-2" style={{ "font-size": "10px", color: "var(--text-muted)" }}>
          <For each={[
            { v: "all", label: "All" },
            { v: "anthropic", label: "Anthropic" },
            { v: "openai", label: "OpenAI" },
            { v: "google", label: "Google" },
            { v: "meta-llama", label: "Meta" },
            { v: "deepseek", label: "DeepSeek" },
            { v: "mistralai", label: "Mistral" },
          ]}>
            {(p) => (
              <button
                onClick={() => setModelProviderFilter(p.v)}
                style={{
                  background: modelProviderFilter() === p.v ? "var(--bg-active)" : "transparent",
                  color: modelProviderFilter() === p.v ? "var(--text-primary)" : "var(--text-muted)",
                  border: modelProviderFilter() === p.v ? "1px solid var(--border-default)" : "1px solid transparent",
                  cursor: "pointer", "font-size": "10px", "font-weight": "500",
                  padding: "2px 6px", "border-radius": "4px",
                }}
              >{p.label}</button>
            )}
          </For>
        </div>
      </div>

      {/* Model list */}
      <div style={{ "overflow-y": "auto", flex: "1", padding: "6px 8px" }}>
        {/* LOCAL — embedded engine, runs in-process, no server needed */}
        <div class="flex items-center gap-2" style={{ padding: "8px 6px 4px" }}>
          <span style={{ "font-size": "10px", "font-weight": "700", color: "var(--text-muted)", "letter-spacing": "0.04em" }}>
            LOCAL — ON YOUR MACHINE
          </span>
          <Show when={scanning()}>
            <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>scanning…</span>
          </Show>
        </div>
        <Show
          when={localMatches().length > 0}
          fallback={
            <div style={{ padding: "6px 6px 10px", "font-size": "11px", color: "var(--text-muted)", "line-height": "1.5" }}>
              No local models found. Download one from the Local Models tab — it
              runs in Clif's built-in engine, no external app needed.
            </div>
          }
        >
          <For each={localMatches()}>
            {(d) => {
              const isActive = () => settings().aiProvider === "local" && settings().aiModel === d.path;
              return (
                <button
                  class="flex items-center justify-between w-full rounded-lg px-3 py-2.5 transition-colors"
                  style={{
                    background: isActive() ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)" : "transparent",
                    border: isActive() ? "1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)" : "1px solid transparent",
                    cursor: "pointer", "text-align": "left", "margin-bottom": "2px",
                  }}
                  onMouseEnter={(e) => { if (!isActive()) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { if (!isActive()) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  onClick={() => { props.onPick("local", d.path); close(); }}
                >
                  <span class="flex items-center gap-2 min-w-0">
                    <span style={{ width: "7px", height: "7px", "border-radius": "999px", background: "#22c55e", "flex-shrink": "0" }} />
                    <span class="truncate" style={{ "font-size": "13px", "font-weight": isActive() ? "700" : "500", color: isActive() ? "var(--accent-primary)" : "var(--text-primary)" }}>{d.name}</span>
                  </span>
                  <span style={{ "font-size": "10px", color: "var(--text-muted)", "white-space": "nowrap", "flex-shrink": "0" }}>{SOURCE_LABEL[d.source]}</span>
                </button>
              );
            }}
          </For>
        </Show>

        {/* CLOUD — OpenRouter */}
        <div style={{ padding: "12px 6px 4px" }}>
          <span style={{ "font-size": "10px", "font-weight": "700", color: "var(--text-muted)", "letter-spacing": "0.04em" }}>
            CLOUD — OPENROUTER
          </span>
        </div>
        <Show when={filteredCloudModels().length === 0 && !fetchingModels()}>
          <div style={{ padding: "32px", "text-align": "center", color: "var(--text-muted)", "font-size": "13px" }}>No models found</div>
        </Show>
        <Show when={fetchingModels()}>
          <div style={{ padding: "32px", "text-align": "center", color: "var(--text-muted)", "font-size": "12px" }}>Loading models from OpenRouter...</div>
        </Show>
        <For each={filteredCloudModels()}>
          {(m: OpenRouterModel) => {
            const priceIn = m.pricing ? formatPrice(m.pricing.prompt) : null;
            const priceOut = m.pricing ? formatPrice(m.pricing.completion) : null;
            const isFree = !parseFloat(m.pricing?.prompt || "0");
            const ctxK = m.context_length ? (m.context_length >= 1_000_000 ? `${(m.context_length/1_000_000).toFixed(0)}M` : `${Math.round(m.context_length/1000)}K`) : null;
            const provider = modelProviderLabel(m.id);
            const shortName = (m.name || m.id).replace(/^[^:]+:\s*/, "");
            const hasVision = m.architecture?.input_modalities?.includes("image");
            const hasThinking = m.supported_parameters?.includes("reasoning") || m.id.includes("thinking") || m.id.includes("r1") || m.id.includes("deepseek-r");
            const isActive = () => settings().aiProvider === "openrouter" && settings().aiModel === m.id;
            const isHovered = () => hoveredModel() === m.id;
            const fullDesc = m.description ? m.description.replace(/\n+/g, " ") : "";

            return (
              <button
                class="w-full text-left rounded-lg px-3 py-2 transition-colors"
                style={{
                  background: isActive() ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)" : "transparent",
                  border: isActive() ? "1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)" : "1px solid transparent",
                  cursor: "pointer", "margin-bottom": "2px",
                  display: "block", transition: "background 0.1s, border-color 0.1s",
                }}
                onMouseEnter={() => setHoveredModel(m.id)}
                onMouseLeave={() => setHoveredModel(null)}
                onClick={() => { props.onPick("openrouter", m.id); close(); }}
              >
                {/* Row 1: name + badges + price */}
                <div class="flex items-center gap-2" style={{ "margin-bottom": "3px" }}>
                  <span style={{
                    "font-size": `${fontSize()}px`, "font-weight": "700",
                    color: isActive() ? "var(--accent-primary)" : "var(--text-primary)",
                    flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                  }}>
                    {shortName}
                  </span>
                  <Show when={hasThinking}>
                    <span title="Reasoning / thinking mode" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>🧠</span>
                  </Show>
                  <Show when={hasVision}>
                    <span title="Accepts image inputs" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>📷</span>
                  </Show>
                  <Show when={isFree}>
                    <span title="Free to use" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>🆓</span>
                  </Show>
                  <span style={{
                    "font-size": `${fontSize() - 1}px`, "font-family": "var(--font-mono, monospace)",
                    "font-weight": "600", "flex-shrink": "0",
                    color: isFree ? "var(--accent-green)" : "var(--text-secondary)",
                  }}>
                    {isFree ? "free" : `${priceIn} / ${priceOut}`}
                  </span>
                </div>

                {/* Row 2: provider · context · short desc (or full on hover) */}
                <div style={{ "font-size": `${fontSize() - 2}px`, color: "var(--text-muted)", display: "flex", "flex-wrap": "wrap", gap: "4px", "align-items": "center" }}>
                  <span style={{ "flex-shrink": "0" }}>{provider}</span>
                  <Show when={ctxK}>
                    <span style={{ "flex-shrink": "0", opacity: "0.5" }}>·</span>
                    <span style={{ "flex-shrink": "0", color: (m.context_length || 0) >= 200_000 ? "var(--accent-blue)" : "var(--text-muted)" }}>
                      {(m.context_length || 0) >= 1_000_000 ? "🔮 " : ""}{ctxK} ctx
                    </span>
                  </Show>
                  <Show when={!isFree && priceIn && priceOut && isHovered()}>
                    <span style={{ "flex-shrink": "0", opacity: "0.5" }}>·</span>
                    <span style={{ "flex-shrink": "0", color: "var(--text-muted)" }}>in: {priceIn} / out: {priceOut} per 1M tokens</span>
                  </Show>
                </div>

                {/* Full description on hover */}
                <Show when={isHovered() && fullDesc}>
                  <div style={{
                    "font-size": `${fontSize() - 2}px`, color: "var(--text-muted)",
                    "line-height": "1.5", "margin-top": "6px",
                    "padding-top": "6px", "border-top": "1px solid var(--border-muted)",
                  }}>
                    {fullDesc}
                  </div>
                </Show>
              </button>
            );
          }}
        </For>
      </div>

      {/* Footer count */}
      <div style={{ padding: "5px 12px", "border-top": "1px solid var(--border-muted)", "font-size": "10px", color: "var(--text-muted)", display: "flex", "justify-content": "space-between" }}>
        <span>{localMatches().length} local · {filteredCloudModels().length} cloud</span>
        <Show when={openRouterModels().length > 0}>
          <span>per 1M tokens · live from openrouter.ai</span>
        </Show>
      </div>
    </div>
  );
};

export default ModelBrowser;
