import { Component, Show, createSignal } from "solid-js";
import { marked } from "marked";

marked.setOptions({ async: false, breaks: true, gfm: true });

// ─── Types (matches ForgeNode from ForgeCanvas) ─────────────────────────────

interface ForgeNode {
  id: string;
  type: 'text' | 'code' | 'result' | 'thinking' | 'tool';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  role?: 'user' | 'assistant';
  language?: string;
  isStreaming?: boolean;
  timestamp: number;
}

interface ForgeCardProps {
  node: ForgeNode;
  isBeingDragged: boolean;
  zoom: number;
  onDragStart: (id: string, e: PointerEvent) => void;
  onBranch?: (id: string) => void;
  onResize?: (id: string, width: number) => void;
}

// ─── Visual helpers ──────────────────────────────────────────────────────────

const typeIcons: Record<string, string> = {
  text: "✦",
  code: "⟨/⟩",
  result: "📋",
  thinking: "💭",
  tool: "⚙",
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Agent",
};

// ─── Component ───────────────────────────────────────────────────────────────

const ForgeCard: Component<ForgeCardProps> = (props) => {
  const [isResizing, setIsResizing] = createSignal(false);
  const [showActions, setShowActions] = createSignal(false);

  const renderContent = () => {
    const node = props.node;

    // Code blocks — render with syntax styling
    if (node.type === 'code') {
      const lang = node.language || 'text';
      return `<div style="font-family: var(--font-mono); font-size: 12px;">
        <div style="color: var(--accent-yellow); margin-bottom: 4px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">${lang}</div>
        <pre style="margin:0; white-space: pre-wrap; word-break: break-all; color: var(--text-primary); font-size: 12px; line-height: 1.5;">${(node.content || "").replace(/</g, "&lt;")}</pre>
      </div>`;
    }

    // Tool results
    if (node.type === 'result') {
      const truncated = node.content.length > 500 ? node.content.slice(0, 500) + "…" : node.content;
      return `<pre style="margin:0; white-space: pre-wrap; word-break: break-all; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); max-height: 200px; overflow: hidden;">${truncated.replace(/</g, "&lt;")}</pre>`;
    }

    // Tool calls
    if (node.type === 'tool') {
      return `<div style="font-family: var(--font-mono); font-size: 12px; opacity: 0.9;">
        <pre style="margin:0; white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px;">${(node.content || "").slice(0, 300).replace(/</g, "&lt;")}${node.content.length > 300 ? "…" : ""}</pre>
      </div>`;
    }

    // Thinking
    if (node.type === 'thinking') {
      return `<div style="font-style: italic; color: var(--text-muted); font-size: 13px;">${(node.content || "").replace(/</g, "&lt;")}</div>`;
    }

    // Text (user & assistant) — render markdown
    try {
      return marked.parse(node.content || "") as string;
    } catch {
      return `<p>${(node.content || "").replace(/</g, "&lt;")}</p>`;
    }
  };

  const handleResizeStart = (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = props.node.width;

    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / props.zoom;
      const newWidth = Math.max(240, Math.min(700, startWidth + delta));
      props.onResize?.(props.node.id, newWidth);
    };

    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      class={`forge-card forge-card-enter ${props.node.isStreaming ? "is-streaming" : ""}`}
      data-role={props.node.role || props.node.type}
      data-type={props.node.type}
      data-node-id={props.node.id}
      classList={{
        "is-dragging": props.isBeingDragged,
        "is-code": props.node.type === "code",
        "is-user": props.node.role === "user",
        "is-tool": props.node.type === "tool" || props.node.type === "result",
      }}
      style={{
        left: `${props.node.x}px`,
        top: `${props.node.y}px`,
        width: `${props.node.width}px`,
      }}
      onPointerEnter={() => setShowActions(true)}
      onPointerLeave={() => setShowActions(false)}
    >
      {/* Header — drag handle */}
      <div
        class="forge-card-header"
        onPointerDown={(e) => {
          e.preventDefault();
          props.onDragStart(props.node.id, e);
        }}
      >
        <span style={{ "font-size": "14px" }}>{typeIcons[props.node.type] || "•"}</span>
        <span style={{
          "font-size": "11px",
          "font-weight": "600",
          "text-transform": "uppercase",
          "letter-spacing": "0.5px",
          color: "var(--text-muted)",
        }}>
          {props.node.role ? roleLabels[props.node.role] || props.node.role : props.node.type}
        </span>

        <Show when={props.node.isStreaming}>
          <span style={{
            "margin-left": "auto",
            "font-size": "10px",
            color: "var(--accent-primary)",
            "font-weight": "500",
          }}>
            streaming…
          </span>
        </Show>

        <Show when={props.node.language}>
          <span style={{
            "margin-left": "auto",
            "font-size": "11px",
            color: "var(--accent-yellow)",
            "font-family": "var(--font-mono)",
          }}>
            {props.node.language}
          </span>
        </Show>

        {/* Branch button — appears on hover */}
        <Show when={showActions() && props.onBranch && props.node.role === 'assistant'}>
          <button
            class="forge-branch-btn"
            onClick={(e) => {
              e.stopPropagation();
              props.onBranch?.(props.node.id);
            }}
            title="Branch conversation from here"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M5 6v6m0-6l3-3m-3 3l-3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M11 10v6m0-6l3-3m-3 3l-3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Branch
          </button>
        </Show>
      </div>

      {/* Body — rendered content */}
      <div
        class="forge-card-body"
        innerHTML={renderContent()}
        style={{
          "max-height": "400px",
          "overflow-y": "auto",
        }}
      />

      {/* Resize handle (right edge) */}
      <div
        style={{
          position: "absolute",
          top: "0",
          right: "0",
          width: "6px",
          height: "100%",
          cursor: "ew-resize",
          "z-index": "10",
        }}
        onPointerDown={handleResizeStart}
      />
    </div>
  );
};

export default ForgeCard;
