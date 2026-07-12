// Live status/usage card. Sits directly under the model selector and above the
// chat, so "is the local model actually running?" is answerable at a glance
// instead of inferred from the chat going quiet.
import { Component, Show, createMemo } from "solid-js";
import { settings } from "../../stores/settingsStore";
import {
  agentMessages,
  agentTokens,
  agentSpeed,
  agentStreaming,
  localContextWindow,
} from "../../stores/agentStore";
import { openRouterModels } from "../../stores/modelBrowserStore";

const Stat: Component<{ label: string; value: string; color?: string; title?: string }> = (p) => (
  <div class="flex flex-col" style={{ gap: "1px", "min-width": "0" }} title={p.title}>
    <span
      style={{
        "font-size": "9px",
        "letter-spacing": "0.05em",
        "text-transform": "uppercase",
        color: "var(--text-muted)",
        "white-space": "nowrap",
      }}
    >
      {p.label}
    </span>
    <span
      class="truncate"
      style={{
        "font-size": "12px",
        "font-weight": "600",
        "font-family": "var(--font-mono, monospace)",
        color: p.color ?? "var(--text-primary)",
      }}
    >
      {p.value}
    </span>
  </div>
);

const Divider: Component = () => (
  <div style={{ width: "1px", "align-self": "stretch", background: "var(--border-muted)", "flex-shrink": "0" }} />
);

const AgentStatsBar: Component = () => {
  const isLocal = () => settings().aiProvider === "local";

  const modelName = () => {
    const m = settings().aiModel;
    if (!m) return "No model";
    if (isLocal()) return (m.split("/").pop() || m).replace(/\.gguf$/i, "");
    const live = openRouterModels().find((x) => x.id === m);
    return (live?.name || m).replace(/^[^:]+:\s*/, "");
  };

  // The engine loads weights from disk on first use, which can take many seconds
  // with no tokens emitted. Streaming with an empty assistant bubble means we're
  // in that window — the single most confusing moment for a local model.
  const loadingWeights = createMemo(() => {
    if (!isLocal() || !agentStreaming()) return false;
    const last = agentMessages[agentMessages.length - 1];
    return !last || last.role !== "assistant" || !last.content.trim();
  });

  // Real per-token pricing from the OpenRouter catalog. Local inference is free —
  // showing a fabricated cost there would be worse than showing none.
  const cost = createMemo(() => {
    if (isLocal()) return 0;
    const m = openRouterModels().find((x) => x.id === settings().aiModel);
    if (!m?.pricing) return null;
    const t = agentTokens();
    const inRate = parseFloat(m.pricing.prompt) || 0;
    const outRate = parseFloat(m.pricing.completion) || 0;
    return t.prompt * inRate + t.completion * outRate;
  });

  const costLabel = () => {
    const c = cost();
    if (c === null) return "—";
    if (c === 0) return "$0.00";
    return c < 0.01 ? `<$0.01` : `$${c.toFixed(2)}`;
  };

  const health = createMemo(() => {
    if (isLocal()) {
      if (loadingWeights()) return { text: "Loading weights…", color: "var(--accent-yellow)", pulse: true };
      if (agentStreaming()) return { text: "Generating", color: "var(--accent-green)", pulse: true };
      return { text: "Ready · in-process", color: "var(--accent-green)", pulse: false };
    }
    if (agentStreaming()) return { text: "Streaming", color: "var(--accent-blue)", pulse: true };
    return { text: "Ready · cloud", color: "var(--text-muted)", pulse: false };
  });

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

  // Context window, resolved the same way for both providers: the local engine
  // reports the window it sized to RAM; OpenRouter publishes it per model.
  const contextWindow = createMemo(() => {
    if (isLocal()) return localContextWindow();
    return openRouterModels().find((x) => x.id === settings().aiModel)?.context_length ?? 0;
  });

  const contextUsed = () => agentTokens().context;

  const contextPct = createMemo(() => {
    const win = contextWindow();
    if (!win) return 0;
    return Math.min(100, (contextUsed() / win) * 100);
  });

  const contextColor = () => {
    const p = contextPct();
    if (p >= 90) return "#ef4444";
    if (p >= 70) return "var(--accent-yellow)";
    return "var(--text-primary)";
  };

  return (
    <div
      class="flex items-center shrink-0"
      style={{
        gap: "12px",
        padding: "7px 10px",
        background: "var(--bg-base)",
        "border-bottom": "1px solid var(--border-muted)",
        overflow: "hidden",
      }}
    >
      {/* Engine health — the headline answer to "is it running?" */}
      <div class="flex items-center" style={{ gap: "6px", "min-width": "0", flex: "1" }}>
        <span
          class={health().pulse ? "animate-pulse" : ""}
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "999px",
            background: health().color,
            "flex-shrink": "0",
          }}
        />
        <div class="flex flex-col" style={{ gap: "1px", "min-width": "0" }}>
          <span
            class="truncate"
            style={{ "font-size": "12px", "font-weight": "600", color: "var(--text-primary)" }}
            title={settings().aiModel}
          >
            {modelName()}
          </span>
          <span class="truncate" style={{ "font-size": "10px", color: health().color }}>
            {health().text}
          </span>
        </div>
      </div>

      <Divider />
      <Stat label="In" value={fmt(agentTokens().prompt)} title="Prompt tokens sent this session" />
      <Stat label="Out" value={fmt(agentTokens().completion)} title="Completion tokens generated this session" />

      <Divider />
      <div class="flex flex-col" style={{ gap: "2px", "min-width": "0" }}>
        <Stat
          label="Context"
          value={contextWindow() ? `${fmt(contextUsed())}/${fmt(contextWindow())}` : "—"}
          color={contextColor()}
          title={
            isLocal()
              ? "Window sized to your RAM and this model's KV cache"
              : "This model's published context window"
          }
        />
        <Show when={contextWindow() > 0}>
          <div
            style={{
              height: "3px",
              width: "100%",
              "border-radius": "999px",
              background: "var(--bg-hover)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(2, contextPct())}%`,
                background: contextColor(),
              }}
            />
          </div>
        </Show>
      </div>

      <Divider />
      <Stat
        label="Speed"
        value={agentSpeed() > 0 ? `${agentSpeed().toFixed(1)} t/s` : "—"}
        title={isLocal() ? "Measured by the local engine (decode only)" : "Measured across the response stream"}
      />

      <Divider />
      <Stat
        label="Cost"
        value={costLabel()}
        color={isLocal() ? "var(--accent-green)" : undefined}
        title={isLocal() ? "Local inference is free" : "Based on this model's live OpenRouter pricing"}
      />
    </div>
  );
};

export default AgentStatsBar;
