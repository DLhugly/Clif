import { createSignal, createEffect, onMount, onCleanup, For, Show, batch } from 'solid-js';
import { prepareWithSegments, layoutNextLine } from '@chenglou/pretext';
import type { AgentMessage } from '../../types/agent';
import { agentMessages, agentStreaming, agentStatus, sendAgentMessage } from '../../stores/agentStore';
import { toggleForgeMode } from '../../stores/uiStore';
import { activeFile, projectRoot } from '../../stores/fileStore';
import { currentBranch } from '../../stores/gitStore';
import { settings } from '../../stores/settingsStore';
import ForgeCard from '../forge/ForgeCard';
import '../../styles/forge.css';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  branchId?: string;      // Which branch this node belongs to
  branchFrom?: string;     // Node ID this branch spawned from
  parentId?: string;       // Parent node in the conversation flow
}

interface Point {
  x: number;
  y: number;
}

// ForgeCanvas reads directly from stores — no props needed

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_GAP = 30;
const DEFAULT_CARD_WIDTH = 420;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const GRID_SIZE = 40;
const PRETEXT_FONT = '14px "Inter", "SF Pro Text", system-ui, sans-serif';
const PRETEXT_CODE_FONT = '13px "JetBrains Mono", "Fira Code", monospace';

// ─── Component ───────────────────────────────────────────────────────────────

export default function ForgeCanvas() {
  // Canvas state
  const [nodes, setNodes] = createSignal<ForgeNode[]>([]);
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal<Point>({ x: 0, y: 0 });

  // Interaction state
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal<Point>({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = createSignal<Point>({ x: 0, y: 0 });
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dragOffset, setDragOffset] = createSignal<Point>({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = createSignal(false); // Space = pan mode like Figma

  // Pretext canvas for text measurement
  const [measureCanvas, setMeasureCanvas] = createSignal<HTMLCanvasElement>();

  // Input
  const [inputText, setInputText] = createSignal('');
  const [showMinimap, setShowMinimap] = createSignal(true);

  let containerRef: HTMLDivElement | undefined;

  // ─── Pretext helpers ─────────────────────────────────────────────────────

  /** Use Pretext to measure text height for a given width */
  const measureTextHeight = (text: string, width: number, isCode: boolean): number => {
    if (!text || width <= 0) return 40;
    try {
      const font = isCode ? PRETEXT_CODE_FONT : PRETEXT_FONT;
      const prepared = prepareWithSegments(text, font);
      const lineHeight = isCode ? 20 : 22;
      let cursor = { segmentIndex: 0, graphemeIndex: 0 };
      let lines = 0;
      while (true) {
        const line = layoutNextLine(prepared, cursor, width - 32); // 32px padding
        if (!line) break;
        cursor = line.end;
        lines++;
      }
      return Math.max(40, lines * lineHeight + 48); // 48px for card chrome (header/padding)
    } catch {
      // Fallback: rough estimate
      const charsPerLine = Math.floor((width - 32) / 8);
      const lines = Math.ceil(text.length / Math.max(charsPerLine, 1));
      return Math.max(40, lines * 22 + 48);
    }
  };

  // ─── Node layout engine ──────────────────────────────────────────────────

  /** Parse a single message into one or more ForgeNodes (separate text vs code blocks) */
  const messageToNodes = (msg: AgentMessage, baseX: number, baseY: number): ForgeNode[] => {
    const result: ForgeNode[] = [];
    const content = msg.content || '';

    // Split content into text blocks and code blocks
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    let offsetY = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Text before this code block
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        const h = measureTextHeight(textBefore, DEFAULT_CARD_WIDTH, false);
        result.push({
          id: `${msg.id}-text-${lastIndex}`,
          type: 'text',
          x: baseX,
          y: baseY + offsetY,
          width: DEFAULT_CARD_WIDTH,
          height: h,
          content: textBefore,
          role: msg.role as 'user' | 'assistant',
          timestamp: Date.now(),
        });
        offsetY += h + CARD_GAP;
      }

      // The code block itself — offset to the right for spatial separation
      const lang = match[1] || 'text';
      const code = match[2].trim();
      const codeH = measureTextHeight(code, DEFAULT_CARD_WIDTH + 60, true);
      result.push({
        id: `${msg.id}-code-${match.index}`,
        type: 'code',
        x: baseX + 80, // indent code blocks to the right
        y: baseY + offsetY,
        width: DEFAULT_CARD_WIDTH + 60,
        height: codeH,
        content: code,
        language: lang,
        role: msg.role as 'user' | 'assistant',
        timestamp: Date.now(),
      });
      offsetY += codeH + CARD_GAP;
      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last code block
    const remaining = content.slice(lastIndex).trim();
    if (remaining) {
      const h = measureTextHeight(remaining, DEFAULT_CARD_WIDTH, false);
      result.push({
        id: `${msg.id}-text-${lastIndex}`,
        type: remaining.startsWith('Tool:') || remaining.startsWith('Result:') ? 'tool' : 'text',
        x: baseX,
        y: baseY + offsetY,
        width: DEFAULT_CARD_WIDTH,
        height: h,
        content: remaining,
        role: msg.role as 'user' | 'assistant',
        timestamp: Date.now(),
      });
    }

    // If nothing was parsed (e.g. empty message), still create a node
    if (result.length === 0) {
      result.push({
        id: `${msg.id}-empty`,
        type: 'text',
        x: baseX,
        y: baseY,
        width: DEFAULT_CARD_WIDTH,
        height: 60,
        content: content || '(empty)',
        role: msg.role as 'user' | 'assistant',
        timestamp: Date.now(),
      });
    }

    return result;
  };

  /** Layout all messages into a flowing spatial arrangement */
  const layoutMessages = (messages: AgentMessage[]): ForgeNode[] => {
    const allNodes: ForgeNode[] = [];
    let cursorX = 60;
    let cursorY = 60;
    let columnMaxY = 60;
    const COLUMN_WIDTH = DEFAULT_CARD_WIDTH + 140;

    for (const msg of messages) {
      // Alternate columns: user on left, assistant flows right
      const baseX = msg.role === 'user' ? cursorX : cursorX + 40;
      const newNodes = messageToNodes(msg, baseX, cursorY);

      for (const node of newNodes) {
        allNodes.push(node);
        const bottom = node.y + node.height + CARD_GAP;
        if (bottom > columnMaxY) columnMaxY = bottom;
      }

      cursorY = columnMaxY;

      // Start new column if we're getting too tall
      if (cursorY > 2000) {
        cursorX += COLUMN_WIDTH;
        cursorY = 60;
        columnMaxY = 60;
      }
    }

    return allNodes;
  };

  // ─── Effects ─────────────────────────────────────────────────────────────

  // Sync messages → spatial nodes (reactive to agentMessages store)
  // CRITICAL: Must access specific properties for SolidJS store reactivity.
  // Spread [...agentMessages] only tracks array structure, not deep mutations.
  // During streaming, agentStore uses produce() to mutate last.content in-place.
  createEffect(() => {
    const len = agentMessages.length; // track array length
    if (len === 0) {
      setNodes([]);
      return;
    }

    // Track streaming content explicitly — access the specific property
    // This makes SolidJS track mutations to the last message's content
    const lastIdx = len - 1;
    const lastContent = agentMessages[lastIdx]?.content; // track content changes
    const lastStatus = agentMessages[lastIdx]?.status;   // track status changes
    const lastRole = agentMessages[lastIdx]?.role;       // track role

    // Now read all messages for layout
    const msgs = agentMessages;
    const isCurrentlyStreaming = lastRole === 'assistant' && lastStatus === 'streaming';

    // Layout all messages into spatial nodes
    const laid = layoutMessages(msgs as AgentMessage[]);

    // Mark the last node as streaming if applicable
    if (isCurrentlyStreaming && laid.length > 0) {
      laid[laid.length - 1].isStreaming = true;
    }

    // Preserve user-dragged positions for existing nodes
    const currentNodes = nodes();
    const merged = laid.map(newNode => {
      const existing = currentNodes.find(n => n.id === newNode.id);
      if (existing && (existing.x !== newNode.x || existing.y !== newNode.y)) {
        // User has dragged this — keep their position but update content/height
        return { ...newNode, x: existing.x, y: existing.y };
      }
      return newNode;
    });

    setNodes(merged);
  });

  // When streaming ends, mark all streaming nodes as static
  createEffect(() => {
    if (!agentStreaming()) {
      setNodes(prev => prev.map(n => (n.isStreaming ? { ...n, isStreaming: false } : n)));
    }
  });

  // ─── Conversation Branching ──────────────────────────────────────────────────
  // The killer Minority Report feature: drag a conversation in a new direction!

  const [branches, setBranches] = createSignal<Map<string, string[]>>(new Map()); // nodeId -> branchIds
  const [activeBranch, setActiveBranch] = createSignal<string | null>(null);

  /** Create a branch from a specific node - places new card to the right */
  const createBranch = (fromNodeId: string) => {
    const sourceNode = nodes().find(n => n.id === fromNodeId);
    if (!sourceNode) return;

    const branchId = `branch-${Date.now()}`;
    const newNode: ForgeNode = {
      id: `${branchId}-prompt`,
      type: 'text',
      x: sourceNode.x + sourceNode.width + 100, // Offset to the right
      y: sourceNode.y,
      width: DEFAULT_CARD_WIDTH,
      height: 80,
      content: '📝 Continue from here… (edit and press Enter)',
      role: 'user',
      timestamp: Date.now(),
      branchId,
      branchFrom: fromNodeId,
    };

    setNodes(prev => [...prev, newNode]);

    // Track branch relationship
    setBranches(prev => {
      const next = new Map(prev);
      const existing = next.get(fromNodeId) || [];
      next.set(fromNodeId, [...existing, branchId]);
      return next;
    });

    // Focus the new card for immediate editing
    setTimeout(() => {
      const textarea = document.querySelector(`[data-node-id="${newNode.id}"] textarea`) as HTMLTextAreaElement;
      textarea?.focus();
      textarea?.select();
    }, 100);
  };

  // ─── Keyboard handlers (Space to pan, Delete to remove) ─────────────────────

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
        setSpaceHeld(true);
        e.preventDefault(); // Prevent page scroll
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  // ─── Pointer event handlers (pan & drag) ─────────────────────────────────

  const screenToCanvas = (screenX: number, screenY: number): Point => {
    const rect = containerRef?.getBoundingClientRect();
    if (!rect) return { x: screenX, y: screenY };
    return {
      x: (screenX - rect.left - pan().x) / zoom(),
      y: (screenY - rect.top - pan().y) / zoom(),
    };
  };

  const handlePointerDown = (e: PointerEvent) => {
    // Middle click, Alt+click, or Space+click = pan (like Figma/Miro)
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && spaceHeld())) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      setPanOrigin({ ...pan() });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Left click — check if we're hitting a card
    if (e.button === 0) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const hit = [...nodes()].reverse().find(n =>
        canvasPos.x >= n.x &&
        canvasPos.x <= n.x + n.width &&
        canvasPos.y >= n.y &&
        canvasPos.y <= n.y + n.height
      );
      if (hit) {
        setDragId(hit.id);
        setDragOffset({ x: canvasPos.x - hit.x, y: canvasPos.y - hit.y });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    }
  };

  /** Called by ForgeCard header when user starts dragging a card */
  const startDrag = (nodeId: string, e: PointerEvent) => {
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    const node = nodes().find(n => n.id === nodeId);
    if (node) {
      setDragId(nodeId);
      setDragOffset({ x: canvasPos.x - node.x, y: canvasPos.y - node.y });
      // Capture pointer on the container so moves outside the card still work
      containerRef?.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (isPanning()) {
      const dx = e.clientX - panStart().x;
      const dy = e.clientY - panStart().y;
      setPan({ x: panOrigin().x + dx, y: panOrigin().y + dy });
      return;
    }

    const currentDragId = dragId();
    if (currentDragId) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setNodes(prev =>
        prev.map(n =>
          n.id === currentDragId
            ? { ...n, x: canvasPos.x - dragOffset().x, y: canvasPos.y - dragOffset().y }
            : n
        )
      );
    }
  };

  const handlePointerUp = (_e: PointerEvent) => {
    setIsPanning(false);
    setDragId(null);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom toward cursor
      const rect = containerRef?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const oldZoom = zoom();
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * (1 - e.deltaY * 0.002)));
      const scale = newZoom / oldZoom;
      setPan(p => ({
        x: mouseX - scale * (mouseX - p.x),
        y: mouseY - scale * (mouseY - p.y),
      }));
      setZoom(newZoom);
    } else {
      // Pan
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  // ─── Actions ─────────────────────────────────────────────────────────────

  const resetView = () => {
    batch(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    });
  };

  const fitToContent = () => {
    const allNodes = nodes();
    if (allNodes.length === 0) return;
    const rect = containerRef?.getBoundingClientRect();
    if (!rect) return;

    const minX = Math.min(...allNodes.map(n => n.x));
    const minY = Math.min(...allNodes.map(n => n.y));
    const maxX = Math.max(...allNodes.map(n => n.x + n.width));
    const maxY = Math.max(...allNodes.map(n => n.y + n.height));

    const contentW = maxX - minX + 120;
    const contentH = maxY - minY + 120;
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const newZoom = Math.max(MIN_ZOOM, Math.min(1.5, Math.min(scaleX, scaleY)));

    batch(() => {
      setZoom(newZoom);
      setPan({
        x: (rect.width - contentW * newZoom) / 2 - minX * newZoom + 60,
        y: (rect.height - contentH * newZoom) / 2 - minY * newZoom + 60,
      });
    });
  };

  /** Build context (same as AgentChatPanel does) so the backend has workspace info */
  const buildContext = () => {
    const ctx: Record<string, any> = {};
    const af = activeFile();
    if (af) ctx.activeFile = af.path;
    const branch = currentBranch();
    if (branch) ctx.gitBranch = branch;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  };

  const sendMessage = () => {
    const text = inputText().trim();
    if (!text || agentStreaming()) return;
    const ctx = buildContext();
    // Support web search if using openrouter
    if (settings().aiProvider === 'openrouter') {
      const baseModel = settings().aiModel.replace(/:online$/, '');
      sendAgentMessage(text, ctx, baseModel + ':online');
    } else {
      sendAgentMessage(text, ctx);
    }
    setInputText('');
  };

  const [isComposing, setIsComposing] = createSignal(false);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Prevent sending during IME composition (CJK input methods use Enter to confirm characters)
    if (isComposing()) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Escape to exit forge mode
    if (e.key === 'Escape') {
      toggleForgeMode();
    }
  };

  // ─── Minimap ─────────────────────────────────────────────────────────────

  const renderMinimap = () => {
    const allNodes = nodes();
    if (allNodes.length === 0) return null;

    const minX = Math.min(...allNodes.map(n => n.x)) - 40;
    const minY = Math.min(...allNodes.map(n => n.y)) - 40;
    const maxX = Math.max(...allNodes.map(n => n.x + n.width)) + 40;
    const maxY = Math.max(...allNodes.map(n => n.y + n.height)) + 40;
    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;

    const mapW = 160;
    const mapH = 100;
    const scaleX = mapW / contentW;
    const scaleY = mapH / contentH;
    const s = Math.min(scaleX, scaleY);

    return (
      <div class="forge-minimap">
        <For each={allNodes}>
          {(node) => (
            <div
              style={{
                position: 'absolute',
                left: `${(node.x - minX) * s}px`,
                top: `${(node.y - minY) * s}px`,
                width: `${node.width * s}px`,
                height: `${node.height * s}px`,
                background: node.type === 'code' ? '#00ffaa33' : node.role === 'user' ? '#3b82f633' : '#ffffff11',
                border: node.isStreaming ? '1px solid #00ffaa' : '1px solid #ffffff22',
                'border-radius': '1px',
              }}
            />
          )}
        </For>
        {/* Viewport indicator */}
        <div
          style={{
            position: 'absolute',
            left: `${(-pan().x / zoom() - minX) * s}px`,
            top: `${(-pan().y / zoom() - minY) * s}px`,
            width: `${((containerRef?.clientWidth || 800) / zoom()) * s}px`,
            height: `${((containerRef?.clientHeight || 600) / zoom()) * s}px`,
            border: '1px solid #00ffaa88',
            background: '#00ffaa08',
            'border-radius': '2px',
          }}
        />
      </div>
    );
  };

  // ─── Double-click to create freeform notes ────────────────────────────────

  const handleDoubleClick = (e: MouseEvent) => {
    // Only on empty canvas, not on cards
    if ((e.target as HTMLElement).closest('.forge-card')) return;
    
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    const id = `note-${Date.now()}`;
    const newNote: ForgeNode = {
      id,
      type: 'text',
      x: canvasPos.x - DEFAULT_CARD_WIDTH / 2,
      y: canvasPos.y - 30,
      width: DEFAULT_CARD_WIDTH,
      height: 100,
      content: '✨ New note — double-click to edit',
      role: 'user',
      timestamp: Date.now(),
    };
    setNodes(prev => [...prev, newNote]);
  };

  // ─── JSX Return ──────────────────────────────────────────────────────────

  return (
    <div
      class="forge-canvas-root"
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDblClick={handleDoubleClick}
      style={{ cursor: spaceHeld() ? 'grab' : isPanning() ? 'grabbing' : dragId() ? 'move' : 'default' }}
    >
      {/* Grid background layer */}
      <div
        class="forge-grid"
        style={{
          'background-position': `${pan().x}px ${pan().y}px`,
          'background-size': `${GRID_SIZE * zoom()}px ${GRID_SIZE * zoom()}px`,
        }}
      />

      {/* Transformed canvas layer — all cards live here */}
      <div
        class="forge-world"
        style={{
          transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
          'transform-origin': '0 0',
        }}
      >
        <For each={nodes()}>
          {(node) => (
            <ForgeCard
              node={node}
              isBeingDragged={dragId() === node.id}
              zoom={zoom()}
              onDragStart={startDrag}
              onBranch={createBranch}
              onResize={(id, width) => {
                setNodes(prev => prev.map(n =>
                  n.id === id ? { ...n, width, height: measureTextHeight(n.content, width, n.type === 'code') } : n
                ));
              }}
            />
          )}
        </For>

        {/* Connection lines between sequential nodes */}
        <svg
          class="forge-connections"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            'pointer-events': 'none',
            overflow: 'visible',
          }}
        >
          {/* Main sequential connections */}
          <For each={nodes()}>
            {(node, i) => {
              const next = nodes()[i() + 1];
              if (!next) return null;
              // Skip if next is a branch (has branchFrom)
              if (next.branchFrom) return null;
              const fromX = node.x + node.width / 2;
              const fromY = node.y + node.height;
              const toX = next.x + next.width / 2;
              const toY = next.y;
              const midY = (fromY + toY) / 2;
              return (
                <path
                  d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
                  stroke={node.isStreaming ? '#00ffaa66' : '#ffffff15'}
                  stroke-width="1.5"
                  fill="none"
                  stroke-dasharray={node.isStreaming ? '6 4' : 'none'}
                />
              );
            }}
          </For>
          {/* Branch connections (horizontal lines to branched nodes) */}
          <For each={nodes()}>
            {(node) => {
              if (!node.branchFrom) return null;
              const sourceNode = nodes().find(n => n.id === node.branchFrom);
              if (!sourceNode) return null;
              const fromX = sourceNode.x + sourceNode.width;
              const fromY = sourceNode.y + sourceNode.height / 2;
              const toX = node.x;
              const toY = node.y + node.height / 2;
              const midX = (fromX + toX) / 2;
              return (
                <path
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                  stroke="#6366f155"
                  stroke-width="2"
                  fill="none"
                  stroke-dasharray="8 4"
                />
              );
            }}
          </For>
        </svg>
      </div>

      {/* ─── HUD Toolbar ─── */}
      <div class="forge-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button class="forge-btn" onClick={toggleForgeMode} title="Exit Forge Mode (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Exit
        </button>
        <div class="forge-toolbar-divider" />
        <button class="forge-btn" onClick={resetView} title="Reset zoom & pan">
          Reset
        </button>
        <button class="forge-btn" onClick={fitToContent} title="Fit all content in view">
          Fit
        </button>
        <div class="forge-toolbar-divider" />
        <span class="forge-zoom-label">{Math.round(zoom() * 100)}%</span>
        <div class="forge-toolbar-divider" />
        <button
          class="forge-btn"
          classList={{ active: showMinimap() }}
          onClick={() => setShowMinimap(v => !v)}
          title="Toggle minimap"
        >
          Map
        </button>
      </div>

      {/* ─── Minimap ─── */}
      <Show when={showMinimap()}>
        {renderMinimap()}
      </Show>

      {/* ─── Floating Input ─── */}
      <div
        class="forge-input-bar"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <textarea
          class="forge-input"
          placeholder="Ask the agent anything… (Enter to send, Shift+Enter for newline)"
          value={inputText()}
          onInput={(e) => setInputText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          rows={1}
        />
        <button
          class="forge-send-btn"
          onClick={sendMessage}
          disabled={!inputText().trim() || agentStreaming()}
        >
          {agentStreaming() ? (
            <div class="forge-spinner" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      {/* ─── Empty state ─── */}
      <Show when={nodes().length === 0 && !agentStreaming()}>
        <div class="forge-empty">
          <div class="forge-empty-icon">⬡</div>
          <h2>ClifForge</h2>
          <p>Spatial AI workspace — drag, zoom, and explore.</p>
          <p class="forge-empty-hint">
            Space+Drag to pan · Alt+Drag to pan · Scroll to zoom · Double-click to add note · Esc to exit
          </p>
        </div>
      </Show>
    </div>
  );
}
