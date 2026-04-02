import { Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup, lazy, Suspense, type Accessor } from "solid-js";
import {
  agentMessages,
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

import { activeFile, projectRoot, fileTree } from "../../stores/fileStore";
import type { FileEntry } from "../../types/files";
import { currentBranch } from "../../stores/gitStore";
import { settings, updateSettings } from "../../stores/settingsStore";
import { fontSize, forgeMode, toggleForgeMode } from "../../stores/uiStore";
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



const BATCH_SIZE = 30; // Number of messages to show/load at a time

const AgentChatPanel: Component = () => {
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
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

  // Load older messages in batches
  function loadMoreMessages() {
    setVisibleCount(prev => prev + BATCH_SIZE);
  }

  // Auto-scroll on new messages
  createEffect(() => {
    const _len = agentMessages.length;
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: "smooth" });
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
      {/* Header: tabs + new session */}
      <div
        class="flex items-center shrink-0"
        style={{
          "border-bottom": "1px solid var(--border-muted)",
          height: "28px",
          background: "var(--bg-surface)",
        }}
      >
        <AgentTabs />

        {/* New session button */}
        <button
          class="flex items-center justify-center shrink-0"
          style={{
            width: "28px", height: "28px",
            color: "var(--text-muted)", background: "transparent",
            border: "none", cursor: "pointer", "font-size": "15px",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          onClick={startNewSession}
          title="New chat"
        >
          +
        </button>

        {/* Init project button */}
        <Show when={projectRoot() && settings().aiProvider !== "ollama"}>
          <button
            class="flex items-center justify-center shrink-0"
            style={{
              width: "28px", height: "28px",
              color: clifInitializing() ? "var(--accent-primary)" : clifExists() ? "var(--accent-green)" : "var(--text-muted)",
              background: "transparent", border: "none",
              cursor: clifInitializing() ? "default" : "pointer",
              "font-size": "13px",
            }}
            onMouseEnter={(e) => { if (!clifInitializing()) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            onClick={handleInitProject}
            title={clifInitializing()
              ? "Analyzing project..."
              : clifExists()
              ? "Re-initialize project context (CLIF.md exists)"
              : "Initialize project context — analyze codebase and write .clif/CLIF.md"}
          >
            <Show when={clifInitializing()} fallback={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <Show when={clifExists()}>
                  <polyline points="9 11 12 14 22 4" />
                </Show>
              </svg>
            }>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            </Show>
          </button>
        </Show>

        {/* Forge Mode toggle */}
        <button
          class="flex items-center justify-center shrink-0"
          style={{
            width: "28px", height: "28px",
            color: forgeMode() ? "#00ffaa" : "var(--text-muted)",
            background: forgeMode() ? "rgba(0,255,170,0.1)" : "transparent",
            border: "none", cursor: "pointer", "font-size": "13px",
            "border-radius": "4px",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = forgeMode() ? "rgba(0,255,170,0.15)" : "var(--bg-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = forgeMode() ? "rgba(0,255,170,0.1)" : "transparent"; }}
          onClick={toggleForgeMode}
          title={forgeMode() ? "Exit Forge Mode (back to IDE)" : "Enter ClifForge — spatial AI canvas"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </button>
      </div>

      {/* Header row 2: provider + model selectors (always visible) */}
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
        />
      </Show>

      {/* Messages */}
      <div class="flex-1 min-h-0 overflow-y-auto py-2" style={{ "padding-bottom": agentStreaming() ? "56px" : "12px" }}>
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
            border: "1px solid var(--border-default)",
          }}
        >
          {/* Attach file button - LEFT */}
          <button
            class="flex items-center justify-center shrink-0 rounded p-1"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--accent-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            }}
            onClick={addActiveFileAsContext}
            title="Attach current file as context"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
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
                        ? "var(--accent-primary)"
                        : "var(--bg-hover)",
                      color: (inputValue().trim() || pastedImages().length > 0) ? "#fff" : "var(--text-muted)",
                      border: "none",
                      cursor: (inputValue().trim() || pastedImages().length > 0) ? "pointer" : "default",
                    }}
                    onClick={() => handleSend(false)}
                    disabled={!inputValue().trim() && pastedImages().length === 0}
                    title="Send message"
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

        {/* Status bar: streaming | web search + tokens - ONE LINE */}
        <div
          class="flex flex-row items-center justify-between mt-2 px-1"
          style={{ height: "20px", "font-size": "12px", color: "var(--text-muted)" }}
        >
          {/* Left: streaming indicator + force stop */}
          <div class="flex items-center gap-3" style={{ "min-width": "0" }}>
            <Show when={agentStreaming()}>
              <div class="flex items-center gap-2">
                <span
                  class="inline-block animate-pulse"
                  style={{ width: "8px", height: "8px", "border-radius": "50%", background: "var(--accent-yellow)", "flex-shrink": "0" }}
                />
                <span style={{ "font-weight": "500" }}>Running...</span>
              </div>
              <button
                class="flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
                style={{
                  background: "var(--accent-red)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  "font-size": "11px",
                  "font-weight": "600",
                }}
                onClick={stopAgent}
                title="Force stop all agent operations"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
                <span>Force Stop</span>
              </button>
            </Show>
          </div>

          {/* Center: keyboard hint */}
          <div class="flex items-center" style={{ opacity: 0.6, "font-size": "11px" }}>
            <span>Enter to send · Shift+Enter for new line</span>
          </div>

          {/* Right: web search + tokens */}
          <div class="flex items-center gap-4" style={{ "flex-shrink": "0" }}>
            <Show when={settings().aiProvider === "openrouter"}>
              <button
                class="flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
                style={{
                  color: webSearchEnabled() ? "var(--accent-blue)" : "var(--text-muted)",
                  background: webSearchEnabled() ? "rgba(59, 130, 246, 0.1)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  "font-size": "12px",
                  "font-weight": "500",
                }}
                onClick={() => setWebSearchEnabled(!webSearchEnabled())}
                title={webSearchEnabled() ? "Web search enabled" : "Enable web search"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span>
                  {webSearchEnabled() ? "Web on" : "Web"}
                </span>
              </button>
            </Show>

            <span style={{ "font-family": "var(--font-mono, monospace)", opacity: 0.8, "font-size": "12px" }}>
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
