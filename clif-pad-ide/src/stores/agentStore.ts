import { createSignal, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage, ToolCall, AgentContext } from "../types/agent";
import { settings } from "./settingsStore";
import { projectRoot } from "./fileStore";
import { saveAgentHistory, loadAgentHistory } from "../lib/tauri";
import { buildBackendMessages } from "../lib/agentMessages";

interface AgentTab {
  id: string;
  label: string;
  messages: AgentMessage[];
  tokens: { prompt: number; completion: number; context: number };
}

const [agentMessages, setAgentMessages] = createStore<AgentMessage[]>([]);
const [agentStreaming, setAgentStreaming] = createSignal(false);
const [agentSessionId, setAgentSessionId] = createSignal<string | null>(null);
const [agentError, setAgentError] = createSignal<string | null>(null);
const [agentTokens, setAgentTokens] = createSignal({ prompt: 0, completion: 0, context: 0 });
const [agentStatus, setAgentStatus] = createSignal("");
// Throughput for the stats bar, in tokens/sec. The local engine measures this
// exactly; for cloud turns we time the stream client-side.
const [agentSpeed, setAgentSpeed] = createSignal(0);
// Context window of the resident local model. The engine derives this from the
// model's KV geometry + this machine's RAM, so it isn't known until a turn runs.
const [localContextWindow, setLocalContextWindow] = createSignal(0);
const [agentTabs, setAgentTabs] = createStore<AgentTab[]>([]);
const [activeAgentTab, setActiveAgentTab] = createSignal("default");
const [queuedMessages, setQueuedMessages] = createSignal<string[]>([]);
let tabCounter = 0;

let unlisteners: UnlistenFn[] = [];
let messageIdCounter = 0;
// Wall-clock start of the current turn's token stream, for cloud throughput.
let turnStartedAt = 0;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Auto-save debounced — called after messages change
function scheduleSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    const root = projectRoot();
    if (!root) return;
    const data = {
      tabs: agentTabs.map(t => ({ ...t })),
      activeTab: activeAgentTab(),
      messages: [...agentMessages],
      tokens: agentTokens(),
      savedAt: Date.now(),
    };
    saveAgentHistory(root, data).catch(() => {});
  }, 1000);
}

// Restore persisted history for a workspace
async function restoreAgentHistory(workspaceDir: string) {
  try {
    const data = await loadAgentHistory(workspaceDir) as any;
    if (!data) return;
    if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0) {
      setAgentTabs(data.tabs);
      tabCounter = data.tabs.length;
    }
    if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
      setAgentMessages(data.messages);
    }
    if (data.tokens) {
      setAgentTokens(data.tokens);
    }
    if (data.activeTab) {
      setActiveAgentTab(data.activeTab);
    }
  } catch {
    // ignore restore errors
  }
}

function genId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

function _doSendAgentMessage(
  userMessage: string,
  modelOverride?: string,
  context?: AgentContext
) {
  const userMsg: AgentMessage = {
    id: genId(),
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
    status: "done",
  };

  setAgentMessages((prev) => [...prev, userMsg]);
  setAgentError(null);
  setAgentStreaming(true);
  scheduleSave();

  const messages = buildBackendMessages([...agentMessages]);

  const s = settings();
  const workspaceDir = projectRoot() || "";

  invoke("agent_chat", {
    messages,
    model: modelOverride || s.aiModel,
    apiKey: null,
    provider: s.aiProvider,
    workspaceDir,
    context: context ? JSON.stringify(context) : null,
    conversationId: activeAgentTab(),
  })
    .then((sid) => setAgentSessionId(sid as string))
    .catch((e) => {
      setAgentStreaming(false);
      setAgentError(String(e));
      setAgentMessages(
        produce((msgs) => {
          msgs.push({
            id: genId(),
            role: "system",
            content: `Failed to send message: ${e}`,
            timestamp: Date.now(),
            status: "error",
          });
        })
      );
    });
}

type UnlistenFn = () => void;

async function initAgentListeners() {
  // Clean up any existing listeners
  for (const fn of unlisteners) fn();
  unlisteners = [];

  // Use getCurrentWebviewWindow().listen() to scope events to this window only
  const appWindow = getCurrentWebviewWindow();

  // State for requestAnimationFrame batching
  let streamBuffer = "";
  let rafId: number | null = null;

  function flushBuffer() {
    if (streamBuffer) {
      setAgentMessages(
        produce((msgs) => {
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant" && last.status === "streaming") {
            last.content += streamBuffer;
          } else {
            msgs.push({
              id: genId(),
              role: "assistant", // Using "assistant" consistently as it represents AI generated text
              content: streamBuffer,
              timestamp: Date.now(),
              status: "streaming",
            });
          }
        })
      );
      streamBuffer = "";
    }
    rafId = null;
  }

  unlisteners.push(
    await appWindow.listen<string>("agent_stream", (event) => {
      const chunk = event.payload;
      if (chunk !== "[DONE]" && turnStartedAt === 0) turnStartedAt = Date.now();
      if (chunk === "[DONE]") {
        turnStartedAt = 0;
        // Ensure any pending buffer is flushed before processing DONE state
        if (rafId) {
          cancelAnimationFrame(rafId);
          flushBuffer();
        }

        // Mark last assistant message as done, or remove it if it has no
        // content (tool-call-only turn — the LLM never emitted any text).
        setAgentMessages(
          produce((msgs) => {
            const last = msgs[msgs.length - 1];
            if (last && last.role === "assistant") {
              if (last.content?.trim()) {
                last.status = "done";
              } else {
                // Empty bubble from a tool-call-only turn — remove it so the
                // UI doesn't show a blank box.
                msgs.splice(msgs.length - 1, 1);
              }
            }
          })
        );
        setAgentStreaming(false);
        // Process queued messages
        const queue = queuedMessages();
        if (queue.length > 0) {
          const nextMsg = queue[0];
          setQueuedMessages(prev => prev.slice(1));
          setTimeout(() => _doSendAgentMessage(nextMsg), 100);
        }
        return;
      }
      
      // Throttle streaming updates using requestAnimationFrame
      streamBuffer += chunk;
      if (!rafId) {
        rafId = requestAnimationFrame(flushBuffer);
      }
    })
  );

  // INSTANT FEEDBACK: Show tool badge immediately when name arrives (before arguments stream)
  unlisteners.push(
    await appWindow.listen<{ name: string; index: number }>("agent_tool_start", (event) => {
      const { name } = event.payload;
      
      setAgentMessages(
        produce((msgs) => {
          // Mark last assistant message done if streaming
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant" && last.status === "streaming") {
            last.status = "done";
          }
          
          // Only add a pending entry if there isn't already one for this tool at the end
          // This prevents duplicates from multiple agent_tool_start events
          const lastMsg = msgs[msgs.length - 1];
          const isAlreadyPending = lastMsg?.role === "tool_call" && 
                                    lastMsg?.toolName === name && 
                                    lastMsg?.status === "pending";
          
          if (!isAlreadyPending) {
            msgs.push({
              id: `tool-start-${Date.now()}`,
              role: "tool_call",
              content: "",
              timestamp: Date.now(),
              toolName: name,
              toolCallId: "", // Will be filled in by agent_tool_call
              toolCalls: [{ id: "", name, arguments: {}, status: "pending" }],
              status: "pending",
            });
          }
        })
      );
    })
  );

  unlisteners.push(
    await appWindow.listen<{ id: string; name: string; arguments: string }>("agent_tool_call", (event) => {
      const { id, name, arguments: argsStr } = event.payload;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        args = { raw: argsStr };
      }
      const toolCall: ToolCall = {
        id,
        name,
        arguments: args,
        argsRaw: argsStr,
        status: "running",
      };

      setAgentMessages(
        produce((msgs) => {
          // Mark last assistant message done if streaming
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant" && last.status === "streaming") {
            last.status = "done";
          }

          // Find and update the LAST pending tool_call entry from agent_tool_start
          // Iterate backwards to find the most recent one (in case of any edge cases)
          let pendingIdx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.role === "tool_call" && m.toolName === name && m.status === "pending") {
              pendingIdx = i;
              break;
            }
          }

          if (pendingIdx !== -1) {
            // Update the existing pending entry with real data
            msgs[pendingIdx].toolCallId = id;
            msgs[pendingIdx].toolCalls = [toolCall];
            msgs[pendingIdx].status = "streaming";
          } else {
            // No pending entry found, create a new one (fallback)
            msgs.push({
              id: genId(),
              role: "tool_call",
              content: "",
              timestamp: Date.now(),
              toolName: name,
              toolCallId: id,
              toolCalls: [toolCall],
              status: "streaming",
            });
          }
        })
      );
    })
  );

  unlisteners.push(
    await appWindow.listen<{ tool_call_id: string; result: string }>("agent_tool_result", (event) => {
      const { tool_call_id, result } = event.payload;
      setAgentMessages(
        produce((msgs) => {
          // Find the tool_call message and update it
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolCallId === tool_call_id) {
              msgs[i].status = "done";
              if (msgs[i].toolCalls?.[0]) {
                msgs[i].toolCalls![0].status = "done";
                msgs[i].toolCalls![0].result = result;
              }
              break;
            }
          }
          // Add tool result message
          msgs.push({
            id: genId(),
            role: "tool_result",
            content: result,
            timestamp: Date.now(),
            toolCallId: tool_call_id,
            status: "done",
          });
        })
      );
    })
  );

  unlisteners.push(
    await appWindow.listen<string>("agent_error", (event) => {
      setAgentError(event.payload);
      setAgentStreaming(false);
      setAgentMessages(
        produce((msgs) => {
          const last = msgs[msgs.length - 1];
          if (last && last.status === "streaming") {
            last.status = "error";
          }
          msgs.push({
            id: genId(),
            role: "system",
            content: `Error: ${event.payload}`,
            timestamp: Date.now(),
            status: "error",
          });
        })
      );
    })
  );

  unlisteners.push(
    await appWindow.listen<string>("agent_session_id", (event) => {
      setAgentSessionId(event.payload);
    })
  );

  unlisteners.push(
    await appWindow.listen<void>("agent_done", () => {
      setAgentStreaming(false);
      setAgentMessages(
        produce((msgs) => {
          const last = msgs[msgs.length - 1];
          if (last && last.status === "streaming") {
            last.status = "done";
          }
        })
      );
      scheduleSave(); // persist after each completed turn
      // Process queued messages
      const queue = queuedMessages();
      if (queue.length > 0) {
        const nextMsg = queue[0];
        setQueuedMessages(prev => prev.slice(1));
        setTimeout(() => {
          const userMsg: AgentMessage = {
            id: genId(),
            role: "user",
            content: nextMsg,
            timestamp: Date.now(),
            status: "done",
          };
          setAgentMessages(produce((msgs) => msgs.push(userMsg)));
          scheduleSave();
          setAgentStreaming(true);
          setAgentError(null);

          const messages = buildBackendMessages([...agentMessages]);

          const s = settings();
          const workspaceDir = projectRoot() || "";

          invoke("agent_chat", {
            messages,
            model: s.aiModel,
            apiKey: null,
            provider: s.aiProvider,
            workspaceDir,
            context: null,
            conversationId: activeAgentTab(),
          })
            .then((sid) => setAgentSessionId(sid as string))
            .catch((e) => {
              setAgentStreaming(false);
              setAgentError(String(e));
              setAgentMessages(
                produce((msgs) => {
                  msgs.push({
                    id: genId(),
                    role: "system",
                    content: `Failed to send message: ${e}`,
                    timestamp: Date.now(),
                    status: "error",
                  });
                })
              );
            });
        }, 100);
      }
    })
  );

  unlisteners.push(
    await appWindow.listen<{ prompt_tokens: number; completion_tokens: number; estimated_context: number }>("agent_usage", (event) => {
      const { prompt_tokens, completion_tokens, estimated_context } = event.payload;
      setAgentTokens((prev) => ({
        prompt: prev.prompt + prompt_tokens,
        completion: prev.completion + completion_tokens,
        context: estimated_context,
      }));
      // Cloud turns don't report throughput, so derive it from the wall-clock we
      // measured across the stream. The local engine overrides this with its own
      // exact figure via `agent_local_stats` below.
      if (turnStartedAt > 0 && completion_tokens > 0) {
        const elapsed = (Date.now() - turnStartedAt) / 1000;
        if (elapsed > 0) setAgentSpeed(completion_tokens / elapsed);
      }
    })
  );

  unlisteners.push(
    await appWindow.listen<{ tokens_per_sec: number; loaded_from_disk: boolean; n_ctx: number }>(
      "agent_local_stats",
      (event) => {
        setAgentSpeed(event.payload.tokens_per_sec);
        setLocalContextWindow(event.payload.n_ctx);
      },
    )
  );

  unlisteners.push(
    await appWindow.listen<string>("agent_status", (event) => {
      setAgentStatus(event.payload);
    })
  );

  // Context-compaction events emit a structured system message so ChatMessage
  // can render a proper explanation card instead of raw markdown text inside
  // the assistant bubble.
  unlisteners.push(
    await appWindow.listen<{
      reason: "auto" | "overflow";
      tokens_before: number;
      tokens_after: number;
      threshold: number;
    }>("agent_context_compacted", (event) => {
      const payload = event.payload;
      setAgentMessages(
        produce((msgs) => {
          msgs.push({
            id: `sys-compact-${Date.now()}`,
            role: "system",
            content: "",
            systemKind: "compaction",
            systemData: {
              reason: payload.reason,
              tokens_before: payload.tokens_before,
              tokens_after: payload.tokens_after,
              threshold: payload.threshold,
            },
            timestamp: Date.now(),
            status: "done",
          });
        })
      );
    })
  );
}

async function sendAgentMessage(content: string, context?: AgentContext, modelOverride?: string, images?: string[]) {
  // If agent is running, queue the message
  if (agentStreaming()) {
    setQueuedMessages(prev => [...prev, content]);
    return;
  }

  const userMsg: AgentMessage = {
    id: genId(),
    role: "user",
    content,
    images: images && images.length > 0 ? images : undefined,
    timestamp: Date.now(),
    status: "done",
  };
  setAgentMessages(produce((msgs) => msgs.push(userMsg)));
  scheduleSave();
  setAgentStreaming(true);
  setAgentError(null);

  const messages = buildBackendMessages([...agentMessages]);

  const s = settings();
  const workspaceDir = projectRoot() || "";

  try {
    await invoke("agent_chat", {
      messages,
      model: modelOverride || s.aiModel,
      apiKey: null,
      provider: s.aiProvider,
      workspaceDir,
      context: context ? JSON.stringify(context) : null,
      conversationId: activeAgentTab(),
    });
  } catch (e) {
    setAgentStreaming(false);
    setAgentError(String(e));
    setAgentMessages(
      produce((msgs) => {
        msgs.push({
          id: genId(),
          role: "system",
          content: `Failed to send message: ${e}`,
          timestamp: Date.now(),
          status: "error",
        });
      })
    );
  }
}

async function stopAgent() {
  const sid = agentSessionId();
  if (sid) {
    try {
      await invoke("agent_stop", { sessionId: sid });
    } catch {
      // ignore
    }
  }
  setAgentStreaming(false);
}

async function forcePushAgent(content: string, context?: AgentContext, modelOverride?: string, images?: string[]) {
  // Stop current agent and clear queue
  const sid = agentSessionId();
  if (sid) {
    try {
      await invoke("agent_stop", { sessionId: sid });
    } catch {
      // ignore
    }
  }
  setAgentStreaming(false);
  setQueuedMessages([]);

  // Send new message immediately
  const userMsg: AgentMessage = {
    id: genId(),
    role: "user",
    content,
    images: images && images.length > 0 ? images : undefined,
    timestamp: Date.now(),
    status: "done",
  };
  setAgentMessages(produce((msgs) => msgs.push(userMsg)));
  scheduleSave();
  setAgentStreaming(true);
  setAgentError(null);

  const messages = buildBackendMessages([...agentMessages]);

  const s = settings();
  const workspaceDir = projectRoot() || "";

  try {
    await invoke("agent_chat", {
      messages,
      model: modelOverride || s.aiModel,
      apiKey: null,
      provider: s.aiProvider,
      workspaceDir,
      context: context ? JSON.stringify(context) : null,
      conversationId: activeAgentTab(),
    });
  } catch (e) {
    setAgentStreaming(false);
    setAgentError(String(e));
    setAgentMessages(
      produce((msgs) => {
        msgs.push({
          id: genId(),
          role: "system",
          content: `Failed to send message: ${e}`,
          timestamp: Date.now(),
          status: "error",
        });
      })
    );
  }
}

function clearAgentMessages() {
  setAgentMessages([]);
  setAgentError(null);
}

function saveCurrentTab() {
  const currentId = activeAgentTab();
  const msgs = [...agentMessages];
  const tokens = agentTokens();
  const idx = agentTabs.findIndex((t) => t.id === currentId);
  if (idx !== -1) {
    // Update existing tab
    setAgentTabs(idx, "messages", msgs);
    setAgentTabs(idx, "tokens", { ...tokens });
  } else if (msgs.length > 0) {
    // Only create a new tab entry if there are messages worth saving
    const firstUserMsg = msgs.find((m) => m.role === "user");
    const label = firstUserMsg
      ? firstUserMsg.content.slice(0, 24) + (firstUserMsg.content.length > 24 ? "..." : "")
      : `Chat ${agentTabs.length + 1}`;
    setAgentTabs(produce((tabs) => tabs.push({ id: currentId, label, messages: msgs, tokens: { ...tokens } })));
  }
}

function switchAgentTab(tabId: string) {
  if (agentStreaming()) return;
  if (tabId === activeAgentTab()) return; // already on this tab
  saveCurrentTab();
  const tab = agentTabs.find((t) => t.id === tabId);
  if (tab) {
    setActiveAgentTab(tabId);
    setAgentMessages(tab.messages);
    setAgentTokens(tab.tokens);
    setAgentError(null);
  }
  scheduleSave();
}

function removeAgentTab(tabId: string) {
  if (agentStreaming()) return;

  // Release backend-side conversation state (read-file set + todos) for
  // the closing tab so a future tab with the same id starts clean and
  // the maps don't grow unbounded across long IDE sessions.
  invoke("agent_clear_conversation", { conversationId: tabId }).catch(() => {});

  const isActive = activeAgentTab() === tabId;

  // Determine which tab to switch to BEFORE removing, so we read from the current state
  let nextTabId: string | null = null;
  if (isActive) {
    const idx = agentTabs.findIndex((t) => t.id === tabId);
    // Prefer the tab to the right, then to the left
    if (idx < agentTabs.length - 1) {
      nextTabId = agentTabs[idx + 1].id;
    } else if (idx > 0) {
      nextTabId = agentTabs[idx - 1].id;
    }
    // If nextTabId is still null, there's no other tab — we'll start fresh
  }

  // Remove the tab from the store
  setAgentTabs(produce((tabs) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx !== -1) tabs.splice(idx, 1);
  }));

  // If we removed the active tab, switch to the next one (or start fresh)
  if (isActive) {
    if (nextTabId) {
      // Load the next tab directly without re-saving the just-removed tab
      const tab = agentTabs.find((t) => t.id === nextTabId);
      if (tab) {
        setActiveAgentTab(nextTabId);
        setAgentMessages(tab.messages);
        setAgentTokens(tab.tokens);
        setAgentError(null);
      } else {
        // Fallback: start fresh
        _resetToNewSession();
      }
    } else {
      _resetToNewSession();
    }
  }
  scheduleSave();
}

/** Internal helper: reset state to a blank session without saving current tab */
function _resetToNewSession() {
  const newId = `chat-${++tabCounter}`;
  setActiveAgentTab(newId);
  setAgentMessages([]);
  setAgentError(null);
  setAgentSessionId(null);
  setAgentTokens({ prompt: 0, completion: 0, context: 0 });
}

function startNewSession() {
  if (agentStreaming()) return;
  // Only save current tab if it has messages
  if (agentMessages.length > 0) {
    saveCurrentTab();
  }
  _resetToNewSession();
  scheduleSave();
}

/**
 * Switch to (or create) a PR-scoped chat tab. Each PR gets its own persistent
 * conversation identified by tab id `pr-<number>`. Safe to call even while
 * another conversation is active.
 */
function ensurePrChat(prNumber: number, label: string) {
  if (agentStreaming()) return;
  const tabId = `pr-${prNumber}`;
  if (activeAgentTab() === tabId) return;
  if (agentMessages.length > 0) saveCurrentTab();
  const existing = agentTabs.find((t) => t.id === tabId);
  if (existing) {
    setActiveAgentTab(tabId);
    setAgentMessages(existing.messages);
    setAgentTokens(existing.tokens);
    setAgentError(null);
    setAgentSessionId(null);
  } else {
    setActiveAgentTab(tabId);
    setAgentMessages([]);
    setAgentTokens({ prompt: 0, completion: 0, context: 0 });
    setAgentError(null);
    setAgentSessionId(null);
    setAgentTabs(
      produce((tabs) => {
        tabs.push({
          id: tabId,
          label,
          messages: [],
          tokens: { prompt: 0, completion: 0, context: 0 },
        });
      }),
    );
  }
  scheduleSave();
}

/**
 * Called when switching to a new project. Cancels any pending save timer
 * so stale state from the previous project cannot overwrite the new one,
 * then resets all agent state to a clean baseline.
 */
function clearAgentState() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  // Drop backend-side conversation state for every tab we are abandoning,
  // including the active one, so a fresh project start cannot inherit
  // stale read-tracking or todos from the previous workspace.
  for (const t of agentTabs) {
    invoke("agent_clear_conversation", { conversationId: t.id }).catch(() => {});
  }
  invoke("agent_clear_conversation", { conversationId: activeAgentTab() }).catch(() => {});
  setAgentMessages([]);
  setAgentTabs([]);
  setAgentError(null);
  setAgentSessionId(null);
  setAgentStreaming(false);
  setAgentTokens({ prompt: 0, completion: 0, context: 0 });
  setAgentStatus("");
  setActiveAgentTab("default");
  tabCounter = 0;
  setQueuedMessages([]);
}

export {
  agentMessages,
  setAgentMessages,
  agentStreaming,
  agentSessionId,
  agentError,
  agentTokens,
  agentStatus,
  agentSpeed,
  localContextWindow,
  agentTabs,
  activeAgentTab,
  initAgentListeners,
  sendAgentMessage,
  stopAgent,
  forcePushAgent,
  clearAgentMessages,
  startNewSession,
  ensurePrChat,
  switchAgentTab,
  removeAgentTab,
  restoreAgentHistory,
  clearAgentState,
  queuedMessages,
};
