import { Component, For, Show, createMemo, onMount } from "solid-js";
import {
  hardware,
  catalog,
  loading,
  error,
  progress,
  variants,
  variantsLoading,
  selectedId,
  discovered,
  scanning,
  refresh,
  select,
  download,
  remove,
  setActive,
} from "../stores/localModelsStore";
import { toggleLocalModels } from "../stores/uiStore";
import type { CatalogEntry, Fit, Speed, DiscoverySource } from "../types/localModels";

const FIT_COLOR: Record<Fit, string> = {
  comfortable: "#22c55e",
  good: "var(--accent-primary)",
  slow: "#f59e0b",
  too_large: "#ef4444",
};

const SPEED_COLOR: Record<Speed, string> = {
  very_fast: "#22c55e",
  fast: "#4ade80",
  moderate: "#f59e0b",
  slower: "#f87171",
};

const ROLE_LABEL: Record<string, string> = {
  agentic: "Agentic",
  reasoning: "Reasoning",
  general: "General",
  autocomplete: "Autocomplete",
};

const SOURCE_META: Record<DiscoverySource, { label: string; color: string }> = {
  ollama: { label: "Ollama", color: "#818cf8" },
  lmstudio: { label: "LM Studio", color: "#f472b6" },
  huggingface: { label: "HF cache", color: "#38bdf8" },
  clif: { label: "Clif", color: "var(--accent-primary)" },
};

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
const num = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;

const Badge: Component<{ color: string; children: any; solid?: boolean }> = (p) => (
  <span
    class="inline-flex items-center rounded-full"
    style={{
      "font-size": "10px",
      "font-weight": "700",
      padding: "2px 9px",
      color: p.solid ? "var(--bg-base)" : p.color,
      background: p.solid ? p.color : `color-mix(in srgb, ${p.color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${p.color} 34%, transparent)`,
      "letter-spacing": "0.02em",
      "white-space": "nowrap",
    }}
  >
    {p.children}
  </span>
);

const Bar: Component<{ value: number; color: string }> = (p) => (
  <div style={{ height: "5px", "border-radius": "999px", background: "var(--bg-hover)", overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.max(3, Math.min(100, p.value))}%`, background: p.color }} />
  </div>
);

const Btn: Component<{ primary?: boolean; disabled?: boolean; onClick: (e: MouseEvent) => void; children: any }> = (p) => (
  <button
    class="rounded-md transition-colors"
    disabled={p.disabled}
    onClick={(e) => { e.stopPropagation(); p.onClick(e); }}
    style={{
      "font-size": "11px",
      "font-weight": "600",
      padding: "6px 14px",
      cursor: p.disabled ? "not-allowed" : "pointer",
      opacity: p.disabled ? "0.45" : "1",
      color: p.primary ? "var(--bg-base)" : "var(--text-primary)",
      background: p.primary ? "var(--accent-primary)" : "var(--bg-hover)",
      border: p.primary ? "none" : "1px solid var(--border-default)",
    }}
  >
    {p.children}
  </button>
);

const Actions: Component<{ e: CatalogEntry }> = (props) => {
  const e = () => props.e;
  const pct = () => progress()[e().id];
  return (
    <Show
      when={pct() === undefined}
      fallback={
        <div class="flex flex-col gap-1 w-full">
          <Bar value={pct() ?? 0} color="var(--accent-primary)" />
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
            <Btn primary disabled={e().fit === "too_large"} onClick={() => download(e().id)}>
              {e().fit === "too_large" ? "Too large" : "Download"}
            </Btn>
          }
        >
          <Show when={!e().active}>
            <Btn primary onClick={() => setActive(e().id)}>Set active</Btn>
          </Show>
          <Show when={e().active}>
            <Badge color="var(--accent-primary)" solid>● Active</Badge>
          </Show>
          <Btn onClick={() => remove(e().id)}>Delete</Btn>
        </Show>
      </div>
    </Show>
  );
};

// ---- Hero recommendation ---------------------------------------------------

const Hero: Component<{ e: CatalogEntry }> = (props) => {
  const e = () => props.e;
  return (
    <div
      class="rounded-xl flex flex-col gap-3"
      style={{
        padding: "20px 22px",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 14%, var(--bg-surface)), var(--bg-surface))",
        border: "1px solid color-mix(in srgb, var(--accent-primary) 45%, transparent)",
      }}
    >
      <div class="flex items-center gap-2">
        <Badge color="var(--accent-primary)" solid>★ Best for your Mac</Badge>
        <Badge color={FIT_COLOR[e().fit]}>{e().fit_label}</Badge>
        <Badge color={SPEED_COLOR[e().speed]}>{e().speed_label}</Badge>
      </div>
      <div class="flex items-end justify-between gap-4 flex-wrap">
        <div class="flex flex-col gap-1 min-w-0">
          <span style={{ "font-size": "20px", "font-weight": "700", color: "var(--text-primary)" }}>
            {e().name}
          </span>
          <span style={{ "font-size": "12px", color: "var(--text-muted)" }}>
            {e().params_b}B{e().active_b < e().params_b ? ` (~${e().active_b}B active)` : ""} · {e().quant} · ~{e().size_gb} GB · {ROLE_LABEL[e().role] ?? e().role}
          </span>
          <p style={{ "font-size": "12px", color: "var(--text-secondary, var(--text-muted))", margin: "4px 0 0", "max-width": "560px", "line-height": "1.5" }}>
            {e().swe_note}
          </p>
        </div>
        <div class="flex flex-col items-end gap-2">
          <Actions e={e()} />
          <button
            onClick={(ev) => { ev.stopPropagation(); select(e().id); }}
            style={{ "font-size": "11px", color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}
          >
            View quants & details →
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Comparison card -------------------------------------------------------

const Card: Component<{ e: CatalogEntry }> = (props) => {
  const e = () => props.e;
  return (
    <div
      class="rounded-lg flex flex-col gap-2.5 cursor-pointer transition-colors"
      onClick={() => select(e().id)}
      style={{
        padding: "14px",
        background: e().active
          ? "color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface))"
          : "var(--bg-surface)",
        border: `1px solid ${
          e().active ? "color-mix(in srgb, var(--accent-primary) 40%, transparent)" : "var(--border-default)"
        }`,
      }}
    >
      <div class="flex items-start justify-between gap-2">
        <span class="truncate" style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-primary)" }}>
          {e().name}
        </span>
        <Badge color={FIT_COLOR[e().fit]}>{e().fit_label}</Badge>
      </div>

      <span style={{ "font-size": "11px", color: "var(--text-muted)" }}>
        {e().params_b}B{e().active_b < e().params_b ? ` · ${e().active_b}B active` : ""} · {e().quant} · ~{e().size_gb} GB
      </span>

      {/* capability + speed meters */}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <span style={{ "font-size": "10px", color: "var(--text-muted)", width: "58px" }}>Coding</span>
          <div style={{ flex: "1" }}><Bar value={e().capability} color="var(--accent-primary)" /></div>
        </div>
        <div class="flex items-center gap-2">
          <span style={{ "font-size": "10px", color: "var(--text-muted)", width: "58px" }}>Speed</span>
          <Badge color={SPEED_COLOR[e().speed]}>{e().speed_label}</Badge>
        </div>
      </div>

      <div class="flex items-center gap-1.5 flex-wrap">
        <Badge color="var(--text-muted)">{ROLE_LABEL[e().role] ?? e().role}</Badge>
        <Show when={e().downloaded && !e().active}><Badge color="#22c55e">Downloaded</Badge></Show>
      </div>

      <div style={{ "margin-top": "2px" }}><Actions e={e()} /></div>
    </div>
  );
};

// ---- HF-verified detail drawer --------------------------------------------

const Detail: Component<{ e: CatalogEntry }> = (props) => {
  const e = () => props.e;
  const v = () => variants()[e().id];
  const isLoading = () => variantsLoading()[e().id];

  return (
    <div
      class="flex flex-col gap-3 rounded-xl"
      style={{ padding: "18px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <span style={{ "font-size": "15px", "font-weight": "700", color: "var(--text-primary)" }}>{e().name}</span>
          <a
            href={`https://huggingface.co/${e().hf_repo}`} target="_blank" rel="noreferrer"
            style={{ "font-size": "11px", color: "var(--accent-primary)", "text-decoration": "none" }}
          >
            {e().hf_repo} ↗
          </a>
        </div>
        <button
          onClick={() => select(null)}
          style={{ "font-size": "11px", color: "var(--text-muted)", background: "var(--bg-hover)", border: "1px solid var(--border-default)", "border-radius": "6px", padding: "4px 10px", cursor: "pointer" }}
        >
          Close
        </button>
      </div>

      {/* HF popularity */}
      <Show when={v()}>
        <div class="flex items-center gap-2 flex-wrap">
          <Badge color="#38bdf8">↓ {num(v()!.downloads)} downloads</Badge>
          <Badge color="#f472b6">♥ {num(v()!.likes)} likes</Badge>
          <Show when={v()!.gated}><Badge color="#f59e0b">Gated — needs HF token</Badge></Show>
          <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>· live from Hugging Face</span>
        </div>
      </Show>

      {/* Quant options with real sizes + per-quant fit */}
      <span style={{ "font-size": "12px", "font-weight": "600", color: "var(--text-primary)", "margin-top": "2px" }}>
        Quantizations
      </span>
      <Show
        when={!isLoading()}
        fallback={<span style={{ "font-size": "11px", color: "var(--text-muted)" }}>Loading quants from Hugging Face…</span>}
      >
        <Show
          when={v() && v()!.variants.length > 0}
          fallback={<span style={{ "font-size": "11px", color: "var(--text-muted)" }}>No GGUF quants resolved (repo may be gated or renamed).</span>}
        >
          <div class="flex flex-col gap-1">
            <For each={v()!.variants}>
              {(q) => (
                <div
                  class="flex items-center justify-between gap-3 rounded-md"
                  style={{
                    padding: "8px 10px",
                    background: q.recommended ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)" : "var(--bg-base)",
                    border: `1px solid ${q.recommended ? "color-mix(in srgb, var(--accent-primary) 30%, transparent)" : "var(--border-default)"}`,
                  }}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span style={{ "font-size": "12px", "font-weight": "600", color: "var(--text-primary)" }}>{q.quant}</span>
                    <Show when={q.recommended}><Badge color="var(--accent-primary)">Recommended</Badge></Show>
                    <span class="truncate" style={{ "font-size": "10px", color: "var(--text-muted)" }}>{q.filename}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span style={{ "font-size": "11px", color: "var(--text-muted)" }}>{gb(q.size_bytes)}</span>
                    <Badge color={FIT_COLOR[q.fit]}>{q.fit_label}</Badge>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <p style={{ "font-size": "11px", color: "var(--text-muted)", margin: "0", "line-height": "1.5" }}>{e().swe_note}</p>
      <div><Actions e={e()} /></div>
    </div>
  );
};

// ---- Screen ----------------------------------------------------------------

const LocalModelsScreen: Component = () => {
  onMount(() => { void refresh(); });

  const recommended = createMemo(() => catalog().find((e) => e.recommended));
  const rest = createMemo(() => catalog().filter((e) => !e.recommended));
  const selected = createMemo(() => catalog().find((e) => e.id === selectedId()) ?? null);

  return (
    <div class="flex flex-col h-full w-full overflow-hidden" style={{ background: "var(--bg-base)", "font-size": "var(--ui-font-size)" }}>
      {/* Header */}
      <div class="flex items-center justify-between shrink-0" style={{ padding: "16px 22px", "border-bottom": "1px solid var(--border-default)" }}>
        <div class="flex flex-col gap-0.5">
          <span style={{ "font-size": "17px", "font-weight": "700", color: "var(--text-primary)" }}>Local Models</span>
          <span style={{ "font-size": "12px", color: "var(--text-muted)" }}>{hardware()?.summary ?? "Detecting hardware…"}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            style={{ "font-size": "12px", color: "var(--text-muted)", background: "var(--bg-hover)", border: "1px solid var(--border-default)", "border-radius": "7px", padding: "6px 12px", cursor: "pointer" }}
          >
            Refresh
          </button>
          <button
            onClick={() => toggleLocalModels()}
            title="Back to editor"
            style={{ "font-size": "12px", color: "var(--text-primary)", background: "var(--bg-hover)", border: "1px solid var(--border-default)", "border-radius": "7px", padding: "6px 12px", cursor: "pointer" }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div style={{ margin: "12px 22px 0", padding: "9px 12px", "border-radius": "8px", "font-size": "12px", color: "#f87171", background: "color-mix(in srgb, #f87171 12%, transparent)", border: "1px solid color-mix(in srgb, #f87171 30%, transparent)" }}>
          {error()}
        </div>
      </Show>

      {/* Body */}
      <div class="flex-1 min-h-0 overflow-y-auto" style={{ padding: "18px 22px", "max-width": "1100px", width: "100%", margin: "0 auto" }}>
        <Show when={!loading() || catalog().length > 0} fallback={<span style={{ color: "var(--text-muted)" }}>Loading catalog…</span>}>
          <div class="flex flex-col gap-4">
            <Show when={recommended()}>
              <Hero e={recommended()!} />
            </Show>

            <Show when={selected()}>
              <Detail e={selected()!} />
            </Show>

            {/* Already on your system */}
            <Show when={discovered().length > 0 || scanning()}>
              <div class="flex items-center gap-2" style={{ "margin-top": "4px" }}>
                <span style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-primary)" }}>
                  Found on your system
                </span>
                <Show when={scanning()}>
                  <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>scanning…</span>
                </Show>
                <Show when={discovered().length > 0}>
                  <Badge color="#818cf8">{discovered().length} GGUF</Badge>
                </Show>
              </div>
              <div class="flex flex-col gap-1">
                <For each={discovered()}>
                  {(d) => (
                    <div
                      class="flex items-center justify-between gap-3 rounded-md"
                      style={{ padding: "8px 11px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <Badge color={SOURCE_META[d.source].color}>{SOURCE_META[d.source].label}</Badge>
                        <span class="truncate" style={{ "font-size": "12px", "font-weight": "600", color: "var(--text-primary)" }}>{d.name}</span>
                        <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>{d.quant}</span>
                      </div>
                      <span style={{ "font-size": "11px", color: "var(--text-muted)", "white-space": "nowrap" }}>{gb(d.size_bytes)}</span>
                    </div>
                  )}
                </For>
                <span style={{ "font-size": "10px", color: "var(--text-muted)", "margin-top": "2px" }}>
                  Detected from Ollama, LM Studio and the Hugging Face cache. Once the local engine lands, these become loadable directly — no re-download.
                </span>
              </div>
            </Show>

            <span style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-primary)", "margin-top": "4px" }}>
              All models — ranked by fit for your hardware
            </span>
            <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              <For each={rest()}>{(e) => <Card e={e} />}</For>
            </div>

            <p style={{ "font-size": "11px", color: "var(--text-muted)", "line-height": "1.6", "margin-top": "6px", opacity: "0.85" }}>
              Sizes, downloads, likes and quant options are pulled live from the
              Hugging Face API — no login required for public models. In-process
              inference (MLX on Mac · llama.cpp on Windows/Linux) is the next
              milestone; selecting a model here will route the agent to it once
              the engine lands.
            </p>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default LocalModelsScreen;
