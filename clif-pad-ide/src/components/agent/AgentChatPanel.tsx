import { Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup, lazy, Suspense, type Accessor } from "solid-js";
import {
  agentMessages,
  setAgentMessages,
  agentSessionId,
  agentStreaming,
  agentTokens,
  agentStatus,
  agentTabs,
  activeAgentTab,
  sendAgentMessage,
  stopAgent,
  forcePushAgent,
  startNewSession,
  switchAgentTab,
  removeAgentTab,
  initAgentListeners,
  restoreAgentHistory,
  queuedMessages,
} from "../../stores/agentStore";
import { invoke } from "@tauri-apps/api/core";
import { produce } from "solid-js/store";

import { activeFile, projectRoot, fileTree } from "../../stores/fileStore";
import type { FileEntry } from "../../types/files";
import { currentBranch } from "../../stores/gitStore";
import { settings, updateSettings } from "../../stores/settingsStore";
import { fontSize } from "../../stores/uiStore";
import { getApiKey, setApiKey as saveApiKey, agentApproveCommand, clifProjectInitialized, clifReadContext, clifInitProject, getModels } from "../../lib/tauri";
import ChatMessage from "./ChatMessage";
import type { AgentContext } from "../../types/agent";

// Extracted sub-components
import { SparkleIcon, SendIcon, StopIcon, KeyIcon, GearIcon } from "./icons";
import { PROVIDERS, POPULAR_MODELS, formatPrice, modelProviderLabel, type OpenRouterModel } from "./constants";
import SetupView from "./SetupView";
import SettingsPanel from "./SettingsPanel";
import ModelBrowser from "./ModelBrowser";
import AgentMarkdownStyles from "./AgentMarkdownStyles";
import ContextFilesPanel from "./ContextFilesPanel";
import MentionDropdown from "./MentionDropdown";
import ChatInputArea from "./ChatInputArea";
import AgentTabs from "./AgentTabs";
import InitProjectBanner from "./InitProjectBanner";
import ProviderModelSelector from "./ProviderModelSelector";
import EmptyState from "./EmptyState";

type SessionTodo = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

function extractTodosFromToolResult(raw: string): SessionTodo[] | null {
  try {
    const parsed = JSON.parse(raw);
    const todos = parsed?.ok ? parsed?.result?.todos : parsed?.todos;
    if (!Array.isArray(todos)) return null;
    const validStatuses = new Set(["pending", "in_progress", "completed", "cancelled"]);
    return todos
      .filter((t) => t && typeof t.id === "string" && typeof t.content === "string" && typeof t.status === "string")
      .filter((t) => validStatuses.has(t.status))
      .map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status as SessionTodo["status"],
      }));
  } catch {
    return null;
  }
}



const BATCH_SIZE = 150; // Number of messages to show/load at a time

const AgentChatPanel: Component = () => {
  let messagesEndRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  const [isUserScrolledUp, setIsUserScrolledUp] = createSignal(false);
  // model browser state is held in signals below
  const [inputValue, setInputValue] = createSignal("");
  const [visibleCount, setVisibleCount] = createSignal(BATCH_SIZE); // how many messages to show from the end
  const [contextFiles, setContextFiles] = createSignal<string[]>([]);
  const [initialized, setInitialized] = createSignal(false);
  const [hasApiKey, setHasApiKey] = createSignal<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = createSignal("");
  const [showSettings, setShowSettings] = createSignal(false);
  const [savingKey, setSavingKey] = createSignal(false);
  const [modelDropdownOpen, setModelDropdownOpen] = createSignal(false);
  const [openRouterModels, setOpenRouterModels] = createSignal<OpenRouterModel[]>([]);
  const [ollamaModels, setOllamaModels] = createSignal<{value: string, label: string}[]>([]);
  const [modelSearch, setModelSearch] = createSignal("");
  const [fetchingModels, setFetchingModels] = createSignal(false);
  const [modelSort, setModelSort] = createSignal<"name" | "price-asc" | "price-desc" | "ctx">("name");
  const [modelProviderFilter, setModelProviderFilter] = createSignal("all");
  const [pendingCommand, setPendingCommand] = createSignal<{ sessionId: string; command: string; toolCallId: string } | null>(null);
  const [clifInitializing, setClifInitializing] = createSignal(false);
  const [clifInitProgress, setClifInitProgress] = createSignal<{ step: number; total: number; message: string; elapsed_secs: number }>({ step: 0, total: 15, message: "", elapsed_secs: 0 });
  const [clifExists, setClifExists] = createSignal<boolean | null>(null); // null = checking
  const [webSearchEnabled, setWebSearchEnabled] = createSignal(false);
  const [mentionActive, setMentionActive] = createSignal(false);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [mentionStart, setMentionStart] = createSignal(0);
  const [loadingOllamaModels, setLoadingOllamaModels] = createSignal(false);
  const [pastedImages, setPastedImages] = createSignal<string[]>([]); // base64 data URLs
  const [agentMode, setAgentMode] = createSignal<"agent" | "ask" | "plan">("agent");
  const [taskListExpanded, setTaskListExpanded] = createSignal(true);

  function flattenFileTree(entries: FileEntry[]): string[] {
    const result: string[] = [];
    function walk(list: FileEntry[]) {
      for (const e of list) {
        if (!e.is_dir) result.push(e.path);
        if (e.children) walk(e.children);
      }
    }
    walk(entries);
    return result;
  }

  const mentionSuggestions = createMemo(() => {
    if (!mentionActive()) return [];
    const q = mentionQuery().toLowerCase();
    const root = projectRoot() || "";
    return flattenFileTree(fileTree())
      .map((p) => p.startsWith(root) ? p.slice(root.length + 1) : p)
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 15);
  });

  async function fetchOpenRouterModels() {
    if (openRouterModels().length > 0) return;
    setFetchingModels(true);
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text");
      if (!resp.ok) return;
      const data = await resp.json();
      const models: OpenRouterModel[] = (data.data || [])
        .filter((m: OpenRouterModel) => m.id && !m.id.includes(":free"));
      setOpenRouterModels(models);
    } catch {
      // fall back to static list
    } finally {
      setFetchingModels(false);
    }
  }

  const filteredModels = () => {
    const q = modelSearch().toLowerCase();
    const pf = modelProviderFilter();
    let models = openRouterModels().length > 0
      ? openRouterModels()
      : (POPULAR_MODELS.openrouter || []).map(m => ({ id: m.value, name: m.label }));

    if (q) models = models.filter((m: OpenRouterModel) =>
      m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q)
    );
    if (pf !== "all") models = models.filter((m: OpenRouterModel) =>
      m.id.startsWith(pf + "/")
    );

    const sort = modelSort();
    return [...models].sort((a: OpenRouterModel, b: OpenRouterModel) => {
      if (sort === "name") return (a.name || a.id).localeCompare(b.name || b.id);
      if (sort === "price-asc") return parseFloat(a.pricing?.prompt || "0") - parseFloat(b.pricing?.prompt || "0");
      if (sort === "price-desc") return parseFloat(b.pricing?.prompt || "0") - parseFloat(a.pricing?.prompt || "0");
      if (sort === "ctx") return (b.context_length || 0) - (a.context_length || 0);
      return 0;
    });
  };

  onMount(async () => {
    await initAgentListeners();
    setInitialized(true);
    await checkApiKey();

    // Restore persisted chat history for this project
    if (projectRoot()) {
      await restoreAgentHistory(projectRoot()!);
    }

    // Listen for run_command approval requests from the agent
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const appWindow = getCurrentWebviewWindow();
    const unlisten = await appWindow.listen<{ session_id: string; command: string; tool_call_id: string }>(
      "agent_command_approval",
      (event) => {
        setPendingCommand({
          sessionId: event.payload.session_id,
          command: event.payload.command,
          toolCallId: event.payload.tool_call_id,
        });
      }
    );

    // Listen for init progress and completion
    const unlistenProgress = await appWindow.listen<{ step: number; total: number; message: string; elapsed_secs: number }>("clif_init_progress", (event) => {
      setClifInitProgress(event.payload);
    });
    const unlistenDone = await appWindow.listen<{ success: boolean; message: string }>("clif_init_done", (event) => {
      setClifInitializing(false);
      setClifInitProgress({ step: 0, total: 15, message: "", elapsed_secs: 0 });
      if (event.payload.success) {
        setClifExists(true);
      }
    });

    onCleanup(() => { unlisten(); unlistenProgress(); unlistenDone(); });

    // Check if CLIF.md exists for current project
    if (projectRoot()) {
      clifProjectInitialized(projectRoot()!).then((exists) => setClifExists(exists));
    }
  });

  async function loadOllamaModels() {
    if (settings().aiProvider !== "ollama") return;
    
    try {
      setLoadingOllamaModels(true);
      const models = await getModels("ollama", null);
      
      const ollamaList = models.map(model => ({
        value: model.id,
        label: model.name
      }));
      
      setOllamaModels(ollamaList);
      // Auto-select first model if current isn't available
      const currentModel = settings().aiModel;
      const hasCurrentModel = ollamaList.some(m => m.value === currentModel);
      if (!hasCurrentModel && ollamaList.length > 0) {
        updateSettings({ aiModel: ollamaList[0].value });
      }
    } catch (error) {
      console.warn("Failed to load Ollama models:", error);
      // Fallback to hardcoded list
      setOllamaModels([
        { value: "llama3.1", label: "Llama 3.1" },
        { value: "codellama", label: "Code Llama" },
        { value: "mistral", label: "Mistral" },
        { value: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
        { value: "qwen3-coder:30b", label: "qwen3-coder:30b" },
        { value: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
      ]);
    } finally {
      setLoadingOllamaModels(false);
    }
  }

  // Call when provider changes to Ollama
  createEffect(() => {
    if (settings().aiProvider === "ollama") {
      loadOllamaModels();
    }
  });

  async function checkApiKey() {
    const provider = settings().aiProvider;
    if (provider === "ollama") {
      setHasApiKey(true); // Ollama doesn't need a key
      await loadOllamaModels(); // Fetch available models
      return;
    }
    try {
      const key = await getApiKey(provider);
      setHasApiKey(!!key);
    } catch {
      setHasApiKey(false);
    }
  }

  async function handleSaveApiKey() {
    const key = apiKeyInput().trim();
    if (!key) return;
    setSavingKey(true);
    try {
      await saveApiKey(settings().aiProvider, key);
      setHasApiKey(true);
      setApiKeyInput("");
      setShowSettings(false);
    } catch (e) {
      console.error("Failed to save API key:", e);
    } finally {
      setSavingKey(false);
    }
  }

  function handleProviderChange(provider: string) {
    updateSettings({ aiProvider: provider });
    // Set a default model for the provider
    const models = POPULAR_MODELS[provider];
    if (models && models.length > 0) {
      updateSettings({ aiModel: models[0].value });
    }
    // Re-check API key for new provider
    setTimeout(() => checkApiKey(), 100);
    // Pull live model lists for the newly-selected provider so the browser
    // doesn't sit on a stale or empty list. Previously the fetch only ran
    // when the model dropdown was opened from a fresh state — switching
    // providers inside the open browser left it empty.
    if (provider === "openrouter") {
      void fetchOpenRouterModels();
    } else if (provider === "ollama") {
      void loadOllamaModels();
    }
  }

  function handleModelChange(model: string) {
    updateSettings({ aiModel: model });
  }

  // Only render last N messages to keep DOM lean (user can load more)
  const visibleMessages = createMemo(() => {
    const all = agentMessages;
    const count = visibleCount();
    return all.slice(-count);
  });

  // Number of older messages not currently visible
  const hiddenCount = createMemo(() => {
    const total = agentMessages.length;
    const visible = visibleCount();
    return Math.max(0, total - visible);
  });

  // Pick the most recent tool_result that produced a todo list AND remember
  // which message produced it. The msg id lets us auto-clear per-item and
  // panel-wide dismissals when the agent writes a fresh list later.
  const sessionTodoSource = createMemo<{ todos: SessionTodo[]; msgId: string | null }>(
    () => {
      for (let i = agentMessages.length - 1; i >= 0; i--) {
        const msg = agentMessages[i];
        if (msg.role !== "tool_result") continue;
        const todos = extractTodosFromToolResult(msg.content);
        if (todos) return { todos, msgId: msg.id };
      }
      return { todos: [], msgId: null };
    },
  );

  const [taskSourceMsgId, setTaskSourceMsgId] = createSignal<string | null>(null);
  const [dismissedTodoIds, setDismissedTodoIds] = createSignal<Set<string>>(new Set());
  const [taskListDismissed, setTaskListDismissed] = createSignal(false);

  // When the agent writes a new todo list, reset local dismissals so fresh
  // tasks show up rather than being silently filtered.
  createEffect(() => {
    const src = sessionTodoSource().msgId;
    if (src && src !== taskSourceMsgId()) {
      setTaskSourceMsgId(src);
      setDismissedTodoIds(new Set<string>());
      setTaskListDismissed(false);
      setTaskListExpanded(true);
    }
  });

  const sessionTodos = createMemo<SessionTodo[]>(() => {
    const dismissed = dismissedTodoIds();
    return sessionTodoSource().todos.filter((t) => !dismissed.has(t.id));
  });

  function dismissTodo(id: string) {
    setDismissedTodoIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function dismissTaskList() {
    setTaskListDismissed(true);
  }

  function undismissAll() {
    setDismissedTodoIds(new Set<string>());
    setTaskListDismissed(false);
  }

  /**
   * DISCARD — nuke the task list from the agent's context, not just the UI.
   *
   * Mutates the most recent tool_result message to report an empty todo list
   * so subsequent LLM turns see nothing (the provider re-sends the entire
   * conversation each turn; rewriting history is how we actually change what
   * the model remembers). Also clears the server-side SESSION_TODOS map so
   * `todo_read` returns empty too, and inserts a system message explaining
   * what happened.
   *
   * This is irreversible from the UI (no "restore"); that's the whole point
   * vs. plain Dismiss.
   */
  async function discardTaskList() {
    const src = sessionTodoSource();
    if (!src.msgId) return;

    // 1) Rewrite the tool_result so the agent's own history loop no longer
    //    contains the todo data.
    setAgentMessages(
      produce((msgs) => {
        const idx = msgs.findIndex((m) => m.id === src.msgId);
        if (idx >= 0) {
          msgs[idx].content = JSON.stringify({
            ok: true,
            result: { todos: [] },
            note: "User discarded the task list.",
          });
        }
        msgs.push({
          id: `sys-discard-${Date.now()}`,
          role: "system",
          content:
            "Task list discarded by user. The agent will see an empty list going forward.",
          timestamp: Date.now(),
          status: "done",
        });
      }),
    );

    // 2) Clear server-side todos so `todo_read` returns nothing.
    try {
      await invoke("agent_clear_todos", { sessionId: agentSessionId() });
    } catch {
      // Non-fatal; the mutation above is what really matters for the model.
    }

    // 3) Reset local UI state.
    setDismissedTodoIds(new Set<string>());
    setTaskListDismissed(false);
    setTaskSourceMsgId(null);
  }

  const todoCounts = createMemo(() => {
    const todos = sessionTodos();
    return {
      pending: todos.filter((t) => t.status === "pending").length,
      in_progress: todos.filter((t) => t.status === "in_progress").length,
      completed: todos.filter((t) => t.status === "completed").length,
      cancelled: todos.filter((t) => t.status === "cancelled").length,
      total: todos.length,
    };
  });

  const hasDismissedItems = createMemo(() => {
    return sessionTodoSource().todos.some((t) => dismissedTodoIds().has(t.id));
  });

  // Load older messages in batches
  function loadMoreMessages() {
    setVisibleCount(prev => prev + BATCH_SIZE);
  }

  // Track whether user has scrolled up manually
  function handleScroll() {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    // Consider "at bottom" if within 80px of the bottom
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setIsUserScrolledUp(!atBottom);
  }

  // Scroll to bottom programmatically
  function scrollToBottom(smooth = true) {
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    }
  }

  // Auto-scroll on new messages — only if user hasn't scrolled up
  createEffect(() => {
    const _len = agentMessages.length;
    if (!isUserScrolledUp()) {
      scrollToBottom();
    }
  });

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }

  function buildContext(): AgentContext | undefined {
    const ctx: AgentContext = {};
    const af = activeFile();
    if (af) ctx.activeFile = af.path;
    const branch = currentBranch();
    if (branch) ctx.gitBranch = branch;
    const files = contextFiles();
    if (files.length > 0) ctx.files = files;
    ctx.agentMode = agentMode();

    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }

  // Re-check CLIF.md when project changes, auto-init if missing
  createEffect(() => {
    const root = projectRoot();
    if (root) {
      // Restore chat history for new project
      restoreAgentHistory(root);

      setClifExists(null);
      clifProjectInitialized(root).then((exists) => {
        setClifExists(exists);
        // Auto-init in background if no CLIF.md and we have an API key
        if (!exists && settings().aiProvider !== "ollama") {
          handleInitProject();
        }
      });
    } else {
      setClifExists(null);
    }
  });

  async function handleInitProject() {
    const root = projectRoot();
    if (!root || clifInitializing()) return;
    const key = await getApiKey(settings().aiProvider).catch(() => null);
    setClifInitializing(true);
    setClifInitProgress({ step: 0, total: 15, message: "Starting analysis...", elapsed_secs: 0 });
    try {
      await clifInitProject(root, settings().aiModel, key, settings().aiProvider);
    } catch (e) {
      setClifInitializing(false);
      setClifInitProgress({ step: 0, total: 15, message: "", elapsed_secs: 0 });
    }
  }

  async function handleSend(force = false) {
    const text = inputValue().trim();
    const imgs = pastedImages();
    if (!text && imgs.length === 0) return;

    setInputValue("");
    if (inputRef) inputRef.style.height = "auto";
    const ctx = buildContext();
    setContextFiles([]);
    const imagesToSend = imgs.slice();
    setPastedImages([]);

    if (force) {
      // Force push: cancel current agent, clear queue, send immediately
      if (webSearchEnabled() && settings().aiProvider === "openrouter") {
        const baseModel = settings().aiModel.replace(/:online$/, "");
        await forcePushAgent(text, ctx, baseModel + ":online", imagesToSend);
      } else {
        await forcePushAgent(text, ctx, undefined, imagesToSend);
      }
    } else if (agentStreaming() || clifInitializing()) {
      // Queue the message
      sendAgentMessage(text, ctx, undefined, imagesToSend);
    } else {
      // Send immediately
      if (webSearchEnabled() && settings().aiProvider === "openrouter") {
        const baseModel = settings().aiModel.replace(/:online$/, "");
        await sendAgentMessage(text, ctx, baseModel + ":online", imagesToSend);
      } else {
        await sendAgentMessage(text, ctx, undefined, imagesToSend);
      }
    }
  }

  function selectMention(relPath: string) {
    const root = projectRoot() || "";
    const fullPath = root + "/" + relPath;
    if (!contextFiles().includes(fullPath)) {
      setContextFiles([...contextFiles(), fullPath]);
    }
    const val = inputValue();
    const before = val.slice(0, mentionStart());
    const after = val.slice(inputRef?.selectionStart ?? val.length);
    setInputValue(before + after);
    setMentionActive(false);
    inputRef?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (mentionActive() && mentionSuggestions().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionSuggestions().length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionSuggestions()[mentionIndex()]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionActive(false);
        return;
      }
    }
    // Enter: send message (queue if agent running)
    // Shift+Enter: newline (default browser behavior - do nothing)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    // We have image(s) — prevent default only if we're consuming image data
    e.preventDefault();
    imageItems.forEach((item) => {
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPastedImages((imgs) => [...imgs, dataUrl]);
      };
      reader.readAsDataURL(blob);
    });
  }

  function removePastedImage(idx: number) {
    setPastedImages((imgs) => imgs.filter((_, i) => i !== idx));
  }

  function addActiveFileAsContext() {
    const af = activeFile();
    if (af && !contextFiles().includes(af.path)) {
      setContextFiles([...contextFiles(), af.path]);
    }
  }

  function removeContextFile(path: string) {
    setContextFiles(contextFiles().filter((f) => f !== path));
  }

  // SetupView is now imported from ./SetupView

  // SettingsPanel is now imported from ./SettingsPanel

  return (
    <div
      class="flex flex-col h-full overflow-hidden"
      style={{
        background: "var(--bg-surface)",
        "font-size": "var(--ui-font-size)",
        position: "relative",
      }}
    >
      {/* Unified header: tabs (with inline + button) · model chip · init.
          Two chunky rows + a duplicate "+" collapsed into one 32px strip. */}
      <div
        class="flex items-center shrink-0"
        style={{
          "border-bottom": "1px solid var(--border-muted)",
          height: "32px",
          background: "var(--bg-surface)",
          padding: "0 6px",
          gap: "6px",
        }}
      >
        {/* Left: tabs (already includes its own + button) */}
        <div class="flex-1 min-w-0" style={{ display: "flex", "align-items": "center" }}>
          <AgentTabs />
        </div>

        {/* Right: model chip + init project. Provider toggle lives inside
            the model chip's browser now, so we don't duplicate controls. */}
        <ProviderModelSelector
          modelDropdownOpen={modelDropdownOpen}
          setModelDropdownOpen={setModelDropdownOpen}
          openRouterModels={openRouterModels}
          fetchOpenRouterModels={fetchOpenRouterModels}
          hasApiKey={hasApiKey}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          handleProviderChange={handleProviderChange}
        />

        <Show when={projectRoot() && settings().aiProvider !== "ollama"}>
          <button
            class="flex items-center justify-center shrink-0 rounded-full transition-colors"
            style={{
              width: "22px",
              height: "22px",
              border: "1px solid var(--border-default)",
              background: "var(--bg-hover)",
              color: clifInitializing()
                ? "var(--accent-primary)"
                : clifExists()
                ? "var(--accent-green)"
                : "var(--text-muted)",
              cursor: clifInitializing() ? "default" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!clifInitializing())
                (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
            }}
            onClick={handleInitProject}
            title={
              clifInitializing()
                ? "Analyzing project..."
                : clifExists()
                ? "Re-initialize project context (CLIF.md exists)"
                : "Initialize project context — analyze codebase and write .clif/CLIF.md"
            }
          >
            <Show
              when={clifInitializing()}
              fallback={
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <Show when={clifExists()}>
                    <polyline points="9 11 12 14 22 4" />
                  </Show>
                </svg>
              }
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </Show>
          </button>
        </Show>
      </div>

      {/* API key input (toggled by key icon) */}
      <Show when={showSettings() && settings().aiProvider !== "ollama"}>
        <div
          class="flex items-center gap-1.5 shrink-0 px-2 py-1.5"
          style={{ "border-bottom": "1px solid var(--border-default)" }}
        >
          <input
            type="password"
            class="flex-1 min-w-0 rounded-md px-2 py-1 outline-none"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-muted)",
              "font-size": "11px",
            }}
            placeholder={settings().aiProvider === "openrouter" ? "sk-or-..." : "API key"}
            value={apiKeyInput()}
            onInput={(e) => setApiKeyInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveApiKey();
              if (e.key === "Escape") setShowSettings(false);
            }}
            ref={(el) => setTimeout(() => el.focus(), 50)}
          />
          <button
            class="shrink-0 rounded-md px-2.5 py-1 transition-colors"
            style={{
              background: apiKeyInput().trim() ? "var(--accent-primary)" : "var(--bg-hover)",
              color: apiKeyInput().trim() ? "#fff" : "var(--text-muted)",
              border: "none",
              cursor: apiKeyInput().trim() ? "pointer" : "default",
              "font-size": "11px",
              "font-weight": "500",
            }}
            disabled={!apiKeyInput().trim()}
            onClick={handleSaveApiKey}
          >
            {savingKey() ? "..." : "Save"}
          </button>
        </div>
      </Show>

      {/* Non-blocking init banner — appears at top of messages when scanning */}
      <Show when={clifInitializing()}>
        <InitProjectBanner progress={clifInitProgress()} />
      </Show>

      {/* placeholder for future ready indicator */}

      {/* Model browser — full overlay over chat when open */}
      <Show when={modelDropdownOpen()}>
        <ModelBrowser
          modelSearch={modelSearch}
          setModelSearch={setModelSearch}
          modelSort={modelSort}
          setModelSort={setModelSort}
          modelProviderFilter={modelProviderFilter}
          setModelProviderFilter={setModelProviderFilter}
          openRouterModels={openRouterModels}
          ollamaModels={ollamaModels}
          fetchingModels={fetchingModels}
          loadingOllamaModels={loadingOllamaModels}
          loadOllamaModels={loadOllamaModels}
          filteredModels={filteredModels}
          handleModelChange={handleModelChange}
          setModelDropdownOpen={setModelDropdownOpen}
          handleProviderChange={handleProviderChange}
        />
      </Show>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        class="flex-1 min-h-0 overflow-y-auto py-2 relative"
        style={{ "padding-bottom": agentStreaming() ? "56px" : "12px" }}
        onScroll={handleScroll}
      >
        <Show
          when={agentMessages.length > 0}
          fallback={
            <EmptyState
              hasApiKey={hasApiKey}
              clifInitializing={clifInitializing}
              projectRoot={projectRoot}
            />
          }
        >
          <Show when={hiddenCount() > 0}>
            <button
              onClick={loadMoreMessages}
              class="w-full text-center py-2 text-xs hover:bg-opacity-50 transition-colors cursor-pointer"
              style={{ color: "var(--text-muted)", background: "var(--bg-tertiary)" }}
            >
              Load {Math.min(BATCH_SIZE, hiddenCount())} older messages ({hiddenCount()} hidden)
            </button>
          </Show>
          <For each={visibleMessages()}>
            {(msg) => <ChatMessage message={msg} pendingCommand={pendingCommand} onApprove={async (sid, approved) => { setPendingCommand(null); await agentApproveCommand(sid, approved); }} />}
          </For>
          <Show when={agentStreaming() && agentStatus()}>
            <div
              class="flex items-center gap-2 px-4 py-2"
              style={{ color: "var(--text-muted)", "font-size": `${fontSize() - 2}px` }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin shrink-0">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>{agentStatus()}</span>
            </div>
          </Show>
          <div ref={messagesEndRef} />
        </Show>
        {/* Scroll-to-bottom button */}
        <Show when={isUserScrolledUp()}>
          <button
            onClick={() => { setIsUserScrolledUp(false); scrollToBottom(); }}
            class="sticky bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg transition-all z-10"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-color)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Jump to bottom
          </button>
        </Show>
      </div>

      {/* Files In Context Panel */}
      <Show when={contextFiles().length > 0}>
        <ContextFilesPanel
          files={contextFiles()}
          projectRoot={projectRoot() || ""}
          onRemove={removeContextFile}
          fontSize={fontSize()}
        />
      </Show>

      {/* Agent Task List — hides entirely when `taskListDismissed` is true.
          Shows a small "restore" chip when user has hidden items and wants
          them back. Dismissals reset on the next `todo_write` from the
          agent (new source message id). */}
      <Show when={sessionTodos().length > 0 && !taskListDismissed()}>
        <div
          class="shrink-0 mx-3 mt-2 rounded-lg overflow-hidden"
          style={{
            border: "1px solid var(--border-default)",
            background: "var(--bg-base)",
          }}
        >
          <div
            class="w-full flex items-center gap-2 px-2.5 py-1.5"
            style={{ color: "var(--text-primary)", "font-size": "12px" }}
          >
            <button
              class="flex items-center gap-2 flex-1 min-w-0"
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                "text-align": "left",
              }}
              onClick={() => setTaskListExpanded(!taskListExpanded())}
              title="Toggle task list"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                style={{
                  transform: taskListExpanded() ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                  "flex-shrink": "0",
                  color: "var(--text-muted)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="font-medium" style={{ "flex-shrink": "0" }}>
                Tasks
              </span>
              <span
                class="flex-1 flex items-center gap-1.5 flex-wrap"
                style={{ "font-size": "10.5px" }}
              >
                <Show when={todoCounts().in_progress > 0}>
                  <span
                    class="px-1.5 rounded"
                    style={{
                      background: "color-mix(in srgb, var(--accent-blue) 15%, transparent)",
                      color: "var(--accent-blue)",
                      "font-weight": "500",
                    }}
                  >
                    {todoCounts().in_progress} active
                  </span>
                </Show>
                <Show when={todoCounts().pending > 0}>
                  <span
                    class="px-1.5 rounded"
                    style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
                  >
                    {todoCounts().pending} pending
                  </span>
                </Show>
                <Show when={todoCounts().completed > 0}>
                  <span
                    class="px-1.5 rounded"
                    style={{
                      background: "color-mix(in srgb, var(--accent-green) 12%, transparent)",
                      color: "var(--accent-green)",
                    }}
                  >
                    {todoCounts().completed} done
                  </span>
                </Show>
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  "font-size": "10.5px",
                  "flex-shrink": "0",
                }}
              >
                {todoCounts().total}
              </span>
            </button>
            {/* Dismiss — hides from UI only. Agent still sees the tasks in
                its context; next `todo_write` restores the view. */}
            <button
              class="flex items-center justify-center shrink-0 rounded"
              style={{
                height: "20px",
                padding: "0 8px",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border-default)",
                cursor: "pointer",
                "font-size": "10.5px",
                "font-weight": "500",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              }}
              onClick={dismissTaskList}
              title="Dismiss: hide from view. Agent still sees these tasks; next todo_write restores the panel."
            >
              Dismiss
            </button>
            {/* Discard — wipes from agent's context too. Rewrites the
                tool_result and clears server SESSION_TODOS so the next turn
                the agent sees an empty list. */}
            <button
              class="flex items-center justify-center shrink-0 rounded"
              style={{
                height: "20px",
                padding: "0 8px",
                background: "color-mix(in srgb, var(--accent-red) 12%, transparent)",
                color: "var(--accent-red)",
                border: "1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)",
                cursor: "pointer",
                "font-size": "10.5px",
                "font-weight": "500",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "color-mix(in srgb, var(--accent-red) 22%, transparent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "color-mix(in srgb, var(--accent-red) 12%, transparent)";
              }}
              onClick={() => {
                if (
                  confirm(
                    "Discard the task list from the agent's context?\n\n" +
                      "This rewrites the tool result so the agent stops seeing these tasks in future turns. " +
                      "Your visible chat history above is unchanged — only what the model reads on the next request.",
                  )
                ) {
                  void discardTaskList();
                }
              }}
              title="Discard: remove from agent's context. Agent will see an empty todo list on the next turn."
            >
              Discard
            </button>
          </div>
          <Show when={taskListExpanded()}>
            <div
              class="px-2.5 pb-2"
              style={{
                "max-height": "180px",
                overflow: "auto",
                "font-size": "12px",
                color: "var(--text-secondary)",
                "border-top": "1px solid var(--border-muted)",
              }}
            >
              <For each={sessionTodos()}>
                {(todo) => (
                  <div
                    class="flex items-start gap-2 py-1 group"
                    style={{
                      opacity: todo.status === "cancelled" ? "0.55" : "1",
                      "border-radius": "4px",
                      padding: "2px 4px",
                    }}
                    onMouseEnter={(e) => {
                      const btn = (e.currentTarget as HTMLElement).querySelector(
                        ".todo-remove-btn",
                      ) as HTMLElement | null;
                      if (btn) btn.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      const btn = (e.currentTarget as HTMLElement).querySelector(
                        ".todo-remove-btn",
                      ) as HTMLElement | null;
                      if (btn) btn.style.opacity = "0";
                    }}
                  >
                    <span
                      style={{
                        color:
                          todo.status === "completed"
                            ? "var(--accent-green)"
                            : todo.status === "in_progress"
                            ? "var(--accent-blue)"
                            : todo.status === "cancelled"
                            ? "var(--accent-red)"
                            : "var(--text-muted)",
                        "margin-top": "1px",
                        "font-size": "11px",
                        "flex-shrink": "0",
                        width: "12px",
                      }}
                    >
                      {todo.status === "completed"
                        ? "✓"
                        : todo.status === "in_progress"
                        ? "▶"
                        : todo.status === "cancelled"
                        ? "✕"
                        : "○"}
                    </span>
                    <span
                      class="flex-1 min-w-0"
                      style={{
                        "text-decoration":
                          todo.status === "completed" ? "line-through" : "none",
                        opacity: todo.status === "completed" ? "0.7" : "1",
                      }}
                    >
                      {todo.content}
                    </span>
                    <button
                      class="todo-remove-btn flex items-center justify-center shrink-0 rounded"
                      style={{
                        width: "16px",
                        height: "16px",
                        background: "transparent",
                        color: "var(--text-muted)",
                        border: "none",
                        cursor: "pointer",
                        "font-size": "12px",
                        "line-height": "1",
                        opacity: "0",
                        transition: "opacity 0.1s, background 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                        (e.currentTarget as HTMLElement).style.color = "var(--accent-red)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                      }}
                      onClick={() => dismissTodo(todo.id)}
                      title="Remove from view (doesn't tell the agent)"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* Restore chip — shows only when the user has hidden items or the
          whole list but the agent's todos are still non-empty. Lets them
          reverse the dismissal without needing the agent to rewrite. */}
      <Show
        when={
          (taskListDismissed() && sessionTodoSource().todos.length > 0) ||
          hasDismissedItems()
        }
      >
        <div class="shrink-0 flex justify-center mt-1 mb-1">
          <button
            class="flex items-center gap-1 rounded-full px-2.5 py-0.5"
            style={{
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-default)",
              cursor: "pointer",
              "font-size": "10.5px",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
            }}
            onClick={undismissAll}
            title="Show hidden tasks again"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
            <span>Restore hidden tasks</span>
          </button>
        </div>
      </Show>

      {/* @ mention dropdown */}
      <Show when={mentionActive() && mentionSuggestions().length > 0}>
        <MentionDropdown
          suggestions={mentionSuggestions()}
          selectedIndex={mentionIndex()}
          onSelect={selectMention}
          onHover={setMentionIndex}
          fontSize={fontSize()}
        />
      </Show>

      {/* Input area */}
      <div
        class="shrink-0 px-3 py-2"
        style={{ "border-top": "1px solid var(--border-default)" }}
      >
        {/* Pasted image previews */}
        <Show when={pastedImages().length > 0}>
          <div class="flex flex-wrap gap-2 mb-2">
            <For each={pastedImages()}>
              {(img, idx) => (
                <div class="relative shrink-0" style={{ width: "64px", height: "64px" }}>
                  <img
                    src={img}
                    alt="pasted"
                    style={{
                      width: "64px",
                      height: "64px",
                      "object-fit": "cover",
                      "border-radius": "6px",
                      border: "1px solid var(--border-default)",
                    }}
                  />
                  <button
                    class="absolute flex items-center justify-center"
                    style={{
                      top: "-5px",
                      right: "-5px",
                      width: "16px",
                      height: "16px",
                      "border-radius": "50%",
                      background: "var(--bg-overlay)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      "font-size": "10px",
                      "line-height": "1",
                    }}
                    onClick={() => removePastedImage(idx())}
                    title="Remove image"
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Input row: attach | textarea | send - all on one line */}
        <div
          class="flex flex-row items-end gap-2 rounded-xl px-3 py-2"
          style={{
            background: "var(--bg-base)",
            border: `1px solid ${
              agentMode() === "ask"
                ? "color-mix(in srgb, var(--accent-yellow) 25%, var(--border-default))"
                : agentMode() === "plan"
                ? "color-mix(in srgb, var(--accent-blue) 25%, var(--border-default))"
                : "var(--border-default)"
            }`,
            transition: "border-color 0.15s",
          }}
        >
          {/* Attach file button - LEFT */}
          <button
            class="flex items-center justify-center shrink-0 rounded p-1 relative"
            style={{
              color: contextFiles().length > 0 ? "var(--accent-primary)" : "var(--text-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--accent-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = contextFiles().length > 0 ? "var(--accent-primary)" : "var(--text-muted)";
            }}
            onClick={addActiveFileAsContext}
            title={contextFiles().length > 0 ? `${contextFiles().length} file${contextFiles().length === 1 ? "" : "s"} attached — click to add active file` : "Attach current file as context"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <Show when={contextFiles().length > 0}>
              <span
                class="absolute flex items-center justify-center"
                style={{
                  top: "-2px",
                  right: "-2px",
                  "min-width": "13px",
                  height: "13px",
                  padding: "0 3px",
                  "border-radius": "7px",
                  background: "var(--accent-primary)",
                  color: "#fff",
                  "font-size": "9px",
                  "font-weight": "600",
                  "line-height": "1",
                }}
              >
                {contextFiles().length}
              </span>
            </Show>
          </button>

          {/* Textarea - CENTER */}
          <textarea
            ref={inputRef}
            class="flex-1 resize-none outline-none"
            style={{
              background: "transparent",
              color: "var(--text-primary)",
              border: "none",
              "font-size": `${fontSize()}px`,
              "line-height": "1.4",
              "min-height": "20px",
              "max-height": "150px",
              "font-family": "inherit",
              opacity: queuedMessages().length > 0 ? "0.6" : "1",
            }}
            placeholder={
              queuedMessages().length > 0
                ? `${queuedMessages().length} queued — Shift+Enter to force`
                : (agentStreaming() || clifInitializing())
                ? "Type to queue..."
                : "Ask the agent... (@ for files)"
            }
            rows={1}
            value={inputValue()}
            onInput={(e) => {
              if (queuedMessages().length > 0) return;
              const val = e.currentTarget.value;
              setInputValue(val);
              autoResize(e.currentTarget);

              const cursor = e.currentTarget.selectionStart ?? val.length;
              const textBefore = val.slice(0, cursor);
              const atIdx = textBefore.lastIndexOf("@");
              if (atIdx !== -1 && (atIdx === 0 || textBefore[atIdx - 1] === " " || textBefore[atIdx - 1] === "\n")) {
                const query = textBefore.slice(atIdx + 1);
                if (!query.includes(" ") && !query.includes("\n")) {
                  setMentionActive(true);
                  setMentionQuery(query);
                  setMentionStart(atIdx);
                  setMentionIndex(0);
                  return;
                }
              }
              setMentionActive(false);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />

          {/* Send / Stop / Queue button - RIGHT */}
          <Show
            when={agentStreaming()}
            fallback={
              <Show
                when={queuedMessages().length > 0}
                fallback={
                  <button
                    class="flex items-center justify-center shrink-0 rounded-lg p-1.5 transition-colors"
                    style={{
                      background: (inputValue().trim() || pastedImages().length > 0)
                        ? (agentMode() === "ask" ? "var(--accent-yellow)" : agentMode() === "plan" ? "var(--accent-blue)" : "var(--accent-primary)")
                        : "var(--bg-hover)",
                      color: (inputValue().trim() || pastedImages().length > 0)
                        ? (agentMode() === "ask" ? "#000" : "#fff")
                        : "var(--text-muted)",
                      border: "none",
                      cursor: (inputValue().trim() || pastedImages().length > 0) ? "pointer" : "default",
                    }}
                    onClick={() => handleSend(false)}
                    disabled={!inputValue().trim() && pastedImages().length === 0}
                    title={
                      agentMode() === "ask" ? "Send (Ask mode — read-only)" :
                      agentMode() === "plan" ? "Send (Plan mode — read-only)" :
                      "Send message"
                    }
                  >
                    <SendIcon />
                  </button>
                }
              >
                <button
                  class="flex items-center justify-center shrink-0 rounded-lg px-2 py-1 transition-colors"
                  style={{
                    background: "var(--accent-primary)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    "font-size": "11px",
                    "font-weight": "500",
                  }}
                  onClick={() => handleSend(true)}
                  title="Force send now"
                >
                  {queuedMessages().length}
                  <span style={{ opacity: 0.8, "margin-left": "4px" }}>Force</span>
                </button>
              </Show>
            }
          >
            <button
              class="flex items-center justify-center shrink-0 rounded-lg p-1.5 transition-colors"
              style={{
                background: "var(--accent-red)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
              onClick={stopAgent}
              title="Stop agent"
            >
              <StopIcon />
            </button>
          </Show>
        </div>

        {/* Status: streaming indicator on its own row (only when active) */}
        <Show when={agentStreaming()}>
          <div
            class="flex items-center gap-2 mt-2 px-1"
            style={{ height: "20px", "font-size": "11px", color: "var(--text-muted)" }}
          >
            <span
              class="inline-block animate-pulse"
              style={{ width: "7px", height: "7px", "border-radius": "50%", background: "var(--accent-yellow)", "flex-shrink": "0" }}
            />
            <span style={{ "font-weight": "500" }}>Running</span>
            <Show when={agentStatus()}>
              <span style={{ opacity: 0.8 }}>· {agentStatus()}</span>
            </Show>
            <button
              class="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: "color-mix(in srgb, var(--accent-red) 15%, transparent)",
                color: "var(--accent-red)",
                border: "1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)",
                cursor: "pointer",
                "font-size": "10.5px",
                "font-weight": "600",
              }}
              onClick={stopAgent}
              title="Force stop all agent operations"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
              Stop
            </button>
          </div>
        </Show>

        {/* Control bar: mode (left) + web + tokens (right) */}
        <div
          class="flex flex-row items-center justify-between mt-2 px-1"
          style={{ "font-size": "11px", color: "var(--text-muted)" }}
        >
          {/* Left: mode switcher — pill segmented control matching Code/Review
              and Provider toggles. Each mode has its own accent color so the
              panel border and send button reflect the current mode. */}
          <div class="flex items-center gap-2" style={{ "min-width": "0" }}>
            {(() => {
              const MODES: {
                id: "agent" | "ask" | "plan";
                label: string;
                color: string;
                title: string;
              }[] = [
                { id: "agent", label: "Agent", color: "var(--accent-primary)", title: "Agent mode — can read, edit, and run approved commands" },
                { id: "ask", label: "Ask", color: "var(--accent-yellow)", title: "Ask mode — read-only analysis, no edits or commands" },
                { id: "plan", label: "Plan", color: "var(--accent-blue)", title: "Plan mode — read-only planning before implementation" },
              ];
              return (
                <div
                  class="flex items-center"
                  style={{
                    border: "1px solid var(--border-default)",
                    background: "color-mix(in srgb, var(--bg-base) 70%, transparent)",
                    height: "22px",
                    "border-radius": "999px",
                    padding: "2px",
                    gap: "2px",
                  }}
                  role="tablist"
                  aria-label="Agent mode"
                >
                  <For each={MODES}>
                    {(m) => {
                      const active = () => agentMode() === m.id;
                      return (
                        <button
                          class="flex items-center transition-colors"
                          style={{
                            height: "100%",
                            padding: "0 10px",
                            background: active()
                              ? `color-mix(in srgb, ${m.color} 22%, transparent)`
                              : "transparent",
                            color: active() ? m.color : "var(--text-muted)",
                            border: "none",
                            cursor: "pointer",
                            "font-size": "10.5px",
                            "font-weight": active() ? "700" : "500",
                            "border-radius": "999px",
                            "letter-spacing": "0.01em",
                          }}
                          onClick={() => setAgentMode(m.id)}
                          title={m.title}
                          aria-selected={active()}
                          role="tab"
                        >
                          {m.label}
                        </button>
                      );
                    }}
                  </For>
                </div>
              );
            })()}
            <Show when={agentMode() !== "agent"}>
              <span
                style={{
                  color:
                    agentMode() === "ask"
                      ? "var(--accent-yellow)"
                      : "var(--accent-blue)",
                  "font-size": "10px",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.06em",
                  opacity: 0.85,
                }}
              >
                Read-only
              </span>
            </Show>
          </div>

          {/* Right: web search + tokens */}
          <div class="flex items-center gap-2" style={{ "flex-shrink": "0" }}>
            <Show when={settings().aiProvider === "openrouter"}>
              <button
                class="flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors"
                style={{
                  color: webSearchEnabled() ? "var(--accent-blue)" : "var(--text-muted)",
                  background: webSearchEnabled() ? "color-mix(in srgb, var(--accent-blue) 12%, transparent)" : "transparent",
                  border: `1px solid ${webSearchEnabled() ? "color-mix(in srgb, var(--accent-blue) 30%, transparent)" : "transparent"}`,
                  cursor: "pointer",
                  "font-size": "11px",
                  "font-weight": "500",
                }}
                onClick={() => setWebSearchEnabled(!webSearchEnabled())}
                title={webSearchEnabled() ? "Web search enabled" : "Enable web search"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span>Web</span>
              </button>
            </Show>

            <span
              title={(() => {
                const t = agentTokens();
                return `Prompt: ${t.prompt.toLocaleString()} · Completion: ${t.completion.toLocaleString()} · Context: ${t.context.toLocaleString()}`;
              })()}
              style={{ "font-family": "var(--font-mono, monospace)", opacity: 0.75, "font-size": "11px" }}
            >
              {(() => {
                const t = agentTokens();
                const total = t.prompt + t.completion;
                const cost = (t.prompt * 3 + t.completion * 15) / 1_000_000;
                const totalStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
                return `${totalStr} · $${cost.toFixed(2)}`;
              })()}
            </span>
          </div>
        </div>
      </div>

      <AgentMarkdownStyles />
    </div>
  );
};

export default AgentChatPanel;
