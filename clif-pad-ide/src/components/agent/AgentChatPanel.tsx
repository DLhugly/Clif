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
  startNewSession,
  switchAgentTab,
  removeAgentTab,
  initAgentListeners,
  restoreAgentHistory,
} from "../../stores/agentStore";

import { activeFile, projectRoot, fileTree } from "../../stores/fileStore";
import type { FileEntry } from "../../types/files";
import { currentBranch } from "../../stores/gitStore";
import { settings, updateSettings } from "../../stores/settingsStore";
import { fontSize, forgeMode, toggleForgeMode } from "../../stores/uiStore";
import { getApiKey, setApiKey as saveApiKey, agentApproveCommand, clifProjectInitialized, clifReadContext, clifInitProject, getModels } from "../../lib/tauri";
import ChatMessage from "./ChatMessage";
import ContextChip from "./ContextChip";
import type { AgentContext } from "../../types/agent";

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const PROVIDERS = [
  { value: "openrouter", label: "OpenRouter", hint: "openrouter.ai — access 100+ models" },
  { value: "ollama", label: "Ollama", hint: "Local models — no API key needed" },
];

const POPULAR_MODELS: Record<string, { value: string; label: string }[]> = {
  openrouter: [
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "anthropic/claude-haiku-4", label: "Claude Haiku 4" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash" },
    { value: "deepseek/deepseek-chat-v3", label: "DeepSeek V3" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "codellama", label: "Code Llama" },
    { value: "mistral", label: "Mistral" },
    { value: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
    { value: "qwen3-coder:30b", label: "qwen3-coder:30b" },
    { value: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
  ],
};

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

function formatPrice(priceStr: string): string {
  const n = parseFloat(priceStr);
  if (!n || isNaN(n)) return "free";
  const per1M = n * 1_000_000;
  return per1M < 1 ? `$${per1M.toFixed(2)}` : `$${per1M.toFixed(0)}`;
}

function modelProviderLabel(id: string): string {
  const [vendor] = id.split("/");
  const map: Record<string, string> = {
    anthropic: "Anthropic", openai: "OpenAI", google: "Google",
    meta: "Meta", deepseek: "DeepSeek", mistralai: "Mistral",
    cohere: "Cohere", "x-ai": "xAI", qwen: "Qwen",
    "nvidia": "NVIDIA", "perplexity": "Perplexity",
  };
  return map[vendor] || vendor?.charAt(0).toUpperCase() + vendor?.slice(1) || "Other";
}

const AgentChatPanel: Component = () => {
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  // model browser state is held in signals below
  const [inputValue, setInputValue] = createSignal("");
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
  const [hoveredModel, setHoveredModel] = createSignal<string | null>(null);
  const [pendingCommand, setPendingCommand] = createSignal<{ sessionId: string; command: string; toolCallId: string } | null>(null);
  const [clifInitializing, setClifInitializing] = createSignal(false);
  const [clifInitProgress, setClifInitProgress] = createSignal<{ step: number; total: number; message: string; elapsed_secs: number }>({ step: 0, total: 15, message: "", elapsed_secs: 0 });
  const [clifExists, setClifExists] = createSignal<boolean | null>(null); // null = checking
  const [webSearchEnabled, setWebSearchEnabled] = createSignal(false);
  const [queuedMessage, setQueuedMessage] = createSignal<string | null>(null);
  const [mentionActive, setMentionActive] = createSignal(false);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [mentionStart, setMentionStart] = createSignal(0);
  const [loadingOllamaModels, setLoadingOllamaModels] = createSignal(false);

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

  // Auto-send queued message when agent finishes (and not while init is running)
  createEffect(() => {
    if (!agentStreaming() && !clifInitializing() && queuedMessage()) {
      const msg = queuedMessage()!;
      setQueuedMessage(null);
      setInputValue("");
      if (inputRef) inputRef.style.height = "auto";
      const ctx = buildContext();
      setContextFiles([]);
      if (webSearchEnabled() && settings().aiProvider === "openrouter") {
        const baseModel = settings().aiModel.replace(/:online$/, "");
        sendAgentMessage(msg, ctx, baseModel + ":online");
      } else {
        sendAgentMessage(msg, ctx);
      }
    }
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

  async function handleSend() {
    const text = inputValue().trim();
    if (!text) return;

    // If agent is running OR project is being scanned, queue the message
    if (agentStreaming() || clifInitializing()) {
      setQueuedMessage(text);
      setInputValue("");
      if (inputRef) inputRef.style.height = "auto";
      return;
    }

    setInputValue("");
    if (inputRef) inputRef.style.height = "auto";
    const ctx = buildContext();
    setContextFiles([]);
    if (webSearchEnabled() && settings().aiProvider === "openrouter") {
      const baseModel = settings().aiModel.replace(/:online$/, "");
      await sendAgentMessage(text, ctx, baseModel + ":online");
    } else {
      await sendAgentMessage(text, ctx);
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  // Setup / API key screen
  function SetupView() {
    return (
      <div class="flex flex-col items-center justify-center h-full gap-4 px-6">
        <div
          class="rounded-full p-4"
          style={{ background: "var(--bg-hover)" }}
        >
          <KeyIcon />
        </div>
        <h3
          class="font-medium text-center"
          style={{ color: "var(--text-primary)", "font-size": "15px" }}
        >
          Connect an LLM
        </h3>
        <p
          class="text-center"
          style={{ color: "var(--text-muted)", "font-size": "12px", "line-height": "1.5" }}
        >
          The agent needs an API key to chat. Choose a provider and enter your key below.
        </p>

        {/* Provider picker */}
        <div class="w-full">
          <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
            Provider
          </label>
          <div class="flex flex-col gap-1.5 mt-1">
            <For each={PROVIDERS}>
              {(p) => (
                <button
                  class="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left transition-colors"
                  style={{
                    background: settings().aiProvider === p.value ? "var(--bg-active)" : "var(--bg-base)",
                    border: settings().aiProvider === p.value
                      ? "1px solid var(--accent-primary)"
                      : "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                  onClick={() => handleProviderChange(p.value)}
                >
                  <div class="flex flex-col">
                    <span class="font-medium" style={{ "font-size": "13px" }}>{p.label}</span>
                    <span style={{ "font-size": "11px", color: "var(--text-muted)" }}>{p.hint}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Model picker */}
        <div class="w-full">
          <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
            Model
          </label>
          <select
            class="w-full mt-1 rounded-lg px-3 py-2 outline-none"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              "font-size": "13px",
              cursor: "pointer",
            }}
            value={settings().aiModel}
            onChange={(e) => handleModelChange(e.currentTarget.value)}
          >
            <For each={settings().aiProvider === "ollama" ? ollamaModels() : (POPULAR_MODELS[settings().aiProvider] || [])}>
              {(m) => <option value={m.value}>{m.label}</option>}
            </For>
          </select>
        </div>

        {/* API key input (not shown for Ollama) */}
        <Show when={settings().aiProvider !== "ollama"}>
          <div class="w-full">
            <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
              API Key
            </label>
            <input
              type="password"
              class="w-full mt-1 rounded-lg px-3 py-2 outline-none"
              style={{
                background: "var(--bg-base)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
                "font-size": "13px",
              }}
              placeholder={settings().aiProvider === "openrouter" ? "sk-or-..." : "API key"}
              value={apiKeyInput()}
              onInput={(e) => setApiKeyInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveApiKey();
              }}
            />
          </div>

          <button
            class="w-full rounded-lg py-2.5 font-medium transition-colors"
            style={{
              background: apiKeyInput().trim()
                ? "var(--accent-primary)"
                : "var(--bg-hover)",
              color: apiKeyInput().trim() ? "#fff" : "var(--text-muted)",
              border: "none",
              cursor: apiKeyInput().trim() ? "pointer" : "default",
              "font-size": "13px",
            }}
            disabled={!apiKeyInput().trim() || savingKey()}
            onClick={handleSaveApiKey}
          >
            {savingKey() ? "Saving..." : "Save & Connect"}
          </button>
        </Show>

        {/* For Ollama, just a connect button */}
        <Show when={settings().aiProvider === "ollama"}>
          <p
            class="text-center"
            style={{ color: "var(--text-muted)", "font-size": "11px" }}
          >
            Make sure Ollama is running locally on port 11434.
          </p>
          <button
            class="w-full rounded-lg py-2.5 font-medium transition-colors"
            style={{
              background: "var(--accent-primary)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              "font-size": "13px",
            }}
            onClick={() => setHasApiKey(true)}
          >
            Connect to Ollama
          </button>
        </Show>
      </div>
    );
  }

  // Settings panel (shown when clicking gear in header)
  function SettingsPanel() {
    return (
      <div
        class="shrink-0 px-3 py-3 flex flex-col gap-3"
        style={{ "border-bottom": "1px solid var(--border-default)" }}
      >
        {/* Provider */}
        <div>
          <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
            Provider
          </label>
          <div class="flex gap-1.5 mt-1">
            <For each={PROVIDERS}>
              {(p) => (
                <button
                  class="flex-1 rounded-md px-2 py-1.5 text-center transition-colors"
                  style={{
                    background: settings().aiProvider === p.value ? "var(--bg-active)" : "var(--bg-base)",
                    border: settings().aiProvider === p.value
                      ? "1px solid var(--accent-primary)"
                      : "1px solid var(--border-muted)",
                    color: settings().aiProvider === p.value ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    "font-size": "12px",
                  }}
                  onClick={() => handleProviderChange(p.value)}
                >
                  {p.label}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Model */}
        <div>
          <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
            Model
          </label>
          <select
            class="w-full mt-1 rounded-md px-2 py-1.5 outline-none"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-muted)",
              "font-size": "12px",
              cursor: "pointer",
            }}
            value={settings().aiModel}
            onChange={(e) => handleModelChange(e.currentTarget.value)}
          >
            <For each={settings().aiProvider === "ollama" ? ollamaModels() : (POPULAR_MODELS[settings().aiProvider] || [])}>
              {(m) => <option value={m.value}>{m.label}</option>}
            </For>
          </select>
        </div>

        {/* API Key */}
        <Show when={settings().aiProvider !== "ollama"}>
          <div>
            <label style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
              API Key
            </label>
            <div class="flex gap-1.5 mt-1">
              <input
                type="password"
                class="flex-1 rounded-md px-2 py-1.5 outline-none"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-muted)",
                  "font-size": "12px",
                }}
                placeholder="Update API key..."
                value={apiKeyInput()}
                onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveApiKey();
                }}
              />
              <button
                class="rounded-md px-3 py-1.5 transition-colors"
                style={{
                  background: apiKeyInput().trim() ? "var(--accent-primary)" : "var(--bg-hover)",
                  color: apiKeyInput().trim() ? "#fff" : "var(--text-muted)",
                  border: "none",
                  cursor: apiKeyInput().trim() ? "pointer" : "default",
                  "font-size": "12px",
                }}
                disabled={!apiKeyInput().trim()}
                onClick={handleSaveApiKey}
              >
                Save
              </button>
            </div>
            <Show when={hasApiKey()}>
              <span style={{ "font-size": "10px", color: "var(--accent-green)" }}>
                Key configured
              </span>
            </Show>
          </div>
        </Show>

        {/* Inline AI toggle */}
        <div class="flex items-center justify-between">
          <div>
            <span style={{ "font-size": "11px", color: "var(--text-muted)", "font-weight": "500" }}>
              Inline AI Completions
            </span>
            <p style={{ "font-size": "10px", color: "var(--text-muted)", margin: "2px 0 0 0", opacity: "0.7" }}>
              Ghost text as you type · Tab to accept
            </p>
          </div>
          <button
            onClick={() => updateSettings({ inlineAiEnabled: !settings().inlineAiEnabled })}
            class="rounded-full transition-colors shrink-0"
            style={{
              width: "32px",
              height: "18px",
              background: settings().inlineAiEnabled ? "var(--accent-primary)" : "var(--bg-hover)",
              border: "none",
              cursor: "pointer",
              position: "relative",
            }}
            title={settings().inlineAiEnabled ? "Disable inline AI" : "Enable inline AI"}
          >
            <span
              style={{
                position: "absolute",
                top: "2px",
                left: settings().inlineAiEnabled ? "16px" : "2px",
                width: "14px",
                height: "14px",
                "border-radius": "50%",
                background: "#fff",
                transition: "left 0.15s ease",
                display: "block",
              }}
            />
          </button>
        </div>
      </div>
    );
  }

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
        <div class="flex items-center flex-1 min-w-0 overflow-x-auto" style={{ "padding-left": "4px" }}>
          {/* Saved tabs */}
          <For each={agentTabs}>
            {(tab) => (
              <div
                class="flex items-center shrink-0 cursor-pointer group"
                style={{
                  height: "28px",
                  padding: "0 8px 0 10px",
                  "font-size": "11px",
                  color: activeAgentTab() === tab.id ? "var(--text-primary)" : "var(--text-muted)",
                  background: activeAgentTab() === tab.id ? "var(--bg-base)" : "transparent",
                  "border-right": "1px solid var(--border-default)",
                  transition: "color 0.1s, background 0.1s",
                }}
                onClick={() => switchAgentTab(tab.id)}
                title={tab.label}
              >
                <span style={{ opacity: activeAgentTab() === tab.id ? "1" : "0.6", "white-space": "nowrap", "max-width": "100px", overflow: "hidden", "text-overflow": "ellipsis", display: "inline-block" }}>
                  {tab.label}
                </span>
                <button
                  class="flex items-center justify-center"
                  style={{
                    width: "16px", height: "16px", "margin-left": "4px",
                    "border-radius": "3px", border: "none",
                    background: "transparent", color: "var(--text-muted)",
                    cursor: "pointer", "font-size": "12px",
                    opacity: "0", transition: "opacity 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.style.background = "transparent"; }}
                  onClick={(e) => { e.stopPropagation(); removeAgentTab(tab.id); }}
                  title="Close tab"
                >
                  ×
                </button>
              </div>
            )}
          </For>

          {/* Current session indicator */}
          {(() => {
            const isCurrentActive = () => !agentTabs.find((t) => t.id === activeAgentTab());
            return (
              <div
                class="flex items-center shrink-0 cursor-pointer"
                style={{
                  height: "28px",
                  padding: "0 10px",
                  "font-size": "11px",
                  color: isCurrentActive() ? "var(--text-primary)" : "var(--text-muted)",
                  background: isCurrentActive() ? "var(--bg-base)" : "transparent",
                  "border-right": agentTabs.length > 0 ? "1px solid var(--border-default)" : "none",
                  transition: "color 0.1s, background 0.1s",
                }}
                onClick={() => {
                  if (!isCurrentActive() && !agentStreaming()) {
                    startNewSession();
                  }
                }}
              >
                <SparkleIcon />
                <span style={{ "margin-left": "5px", "white-space": "nowrap", opacity: isCurrentActive() ? "1" : "0.6" }}>
                  {isCurrentActive() && agentMessages.length > 0 ? "Current" : "New Chat"}
                </span>
              </div>
            );
          })()}
        </div>

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
      <div
        class="flex items-center gap-1.5 shrink-0 px-2 py-1.5"
        style={{ "border-bottom": "1px solid var(--border-default)" }}
      >
        {/* Provider toggle */}
        <div class="flex rounded-md overflow-hidden" style={{ border: "1px solid var(--border-muted)" }}>
          <For each={PROVIDERS}>
            {(p) => (
              <button
                class="px-2 py-1 transition-colors"
                style={{
                  background: settings().aiProvider === p.value ? "var(--accent-primary)" : "var(--bg-base)",
                  color: settings().aiProvider === p.value ? "#fff" : "var(--text-muted)",
                  border: "none",
                  cursor: "pointer",
                  "font-size": "11px",
                  "font-weight": "500",
                }}
                onClick={() => handleProviderChange(p.value)}
                title={p.hint}
              >
                {p.label}
              </button>
            )}
          </For>
        </div>

        {/* Model selector — opens full-panel browser */}
        <button
          class="flex items-center gap-1.5 flex-1 min-w-0 rounded-md px-2 py-1 transition-colors group"
          style={{
            background: modelDropdownOpen() ? "var(--bg-active)" : "var(--bg-hover)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
            "font-size": "11px",
            cursor: "pointer",
            "font-family": "var(--font-mono, monospace)",
            "text-align": "left",
          }}
          onClick={() => {
            const next = !modelDropdownOpen();
            setModelDropdownOpen(next);
            if (next && settings().aiProvider === "openrouter") fetchOpenRouterModels();
          }}
          title="Browse and select a model"
        >
          {/* Grid icon to signal "opens browser" */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0", color: "var(--text-muted)" }}>
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          <span class="flex-1 truncate" style={{ "min-width": "0" }}>
            {(() => {
              const current = settings().aiModel;
              const live = openRouterModels().find(m => m.id === current);
              const name = live?.name || (POPULAR_MODELS[settings().aiProvider] || []).find(m => m.value === current)?.label || current;
              // Strip provider prefix like "Anthropic: " or "OpenAI: "
              return name.replace(/^[^:]+:\s*/, "");
            })()}
          </span>
          <span style={{ "font-size": "9px", color: "var(--text-muted)", "flex-shrink": "0", "font-family": "var(--font-sans)" }}>Browse</span>
        </button>

        {/* API key indicator / button */}
        <Show when={settings().aiProvider !== "ollama"}>
          <button
            class="flex items-center justify-center shrink-0 rounded-md p-1 transition-colors"
            style={{
              background: showSettings() ? "var(--bg-hover)" : "transparent",
              color: hasApiKey() ? "var(--accent-green)" : "var(--accent-yellow)",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!showSettings()) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            onClick={() => setShowSettings(!showSettings())}
            title={hasApiKey() ? "API key configured — click to change" : "Set API key"}
          >
            <KeyIcon />
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
        <div
          class="shrink-0 px-3 py-2"
          style={{
            background: "color-mix(in srgb, var(--accent-primary) 6%, transparent)",
            "border-bottom": "1px solid color-mix(in srgb, var(--accent-primary) 12%, transparent)",
          }}
        >
          {/* Top row: icon + message + elapsed */}
          <div class="flex items-center gap-2 mb-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2.5" class="animate-spin shrink-0">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <span style={{ "font-size": "11px", color: "var(--accent-primary)", flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {clifInitProgress().message || "Scanning codebase..."}
            </span>
            <span style={{ "font-size": "10px", color: "var(--text-muted)", "flex-shrink": "0" }}>
              {clifInitProgress().elapsed_secs > 0 ? `${clifInitProgress().elapsed_secs}s` : ""}
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: "3px", background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)", "border-radius": "2px", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, (clifInitProgress().step / clifInitProgress().total) * 100)}%`,
              background: "var(--accent-primary)",
              "border-radius": "2px",
              transition: "width 0.4s ease",
            }} />
          </div>
          {/* Bottom row: step count + hint */}
          <div class="flex items-center justify-between mt-1">
            <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
              Step {clifInitProgress().step} / ~{clifInitProgress().total} — building .clif/CLIF.md
            </span>
            <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
              You can chat while this runs
            </span>
          </div>
        </div>
      </Show>

      {/* placeholder for future ready indicator */}

      {/* Model browser — full overlay over chat when open */}
      <Show when={modelDropdownOpen()}>
        <div
          style={{
            position: "absolute", inset: "0",
            background: "var(--bg-surface)",
            "z-index": "50",
            display: "flex", "flex-direction": "column",
          }}
        >
          {/* Browser header */}
          <div style={{ padding: "10px 12px", "border-bottom": "1px solid var(--border-default)", display: "flex", "align-items": "center", gap: "8px" }}>
            <button
              onClick={() => { setModelDropdownOpen(false); setModelSearch(""); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", "font-size": "18px", "line-height": "1", padding: "0 4px", "flex-shrink": "0" }}
            >←</button>
            <input
              type="text"
              placeholder={fetchingModels() ? "Loading models from OpenRouter..." : "Search models..."}
              value={modelSearch()}
              onInput={(e) => setModelSearch(e.currentTarget.value)}
              autofocus
              style={{
                flex: "1", background: "var(--bg-base)", color: "var(--text-primary)",
                border: "1px solid var(--border-muted)", "border-radius": "6px",
                padding: "5px 8px", "font-size": "12px", outline: "none", "font-family": "inherit",
              }}
            />
          </div>

          {/* Sort + filter bar */}
          <Show when={settings().aiProvider === "openrouter"}>
            <div style={{ padding: "6px 10px", "border-bottom": "1px solid var(--border-muted)", display: "flex", gap: "6px", "align-items": "center", "flex-wrap": "wrap" }}>
              {/* Sort */}
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

              {/* Provider filter */}
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
          </Show>

          {/* Model list */}
          <div style={{ "overflow-y": "auto", flex: "1", padding: "6px 8px" }}>
            <Show when={settings().aiProvider === "ollama"}>
              <Show when={loadingOllamaModels()}>
                <div style={{ padding: "32px", "text-align": "center", color: "var(--text-muted)", "font-size": "12px" }}>Loading Ollama models...</div>
              </Show>
              <Show when={!loadingOllamaModels()}>
                <For each={ollamaModels()}>
                  {(m) => {
                    const isActive = () => settings().aiModel === m.value;
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
                        onClick={() => { handleModelChange(m.value); setModelDropdownOpen(false); setModelSearch(""); }}
                      >
                        <span style={{ "font-size": "13px", "font-weight": "500", color: isActive() ? "var(--accent-primary)" : "var(--text-primary)" }}>{m.label}</span>
                        <Show when={isActive()}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </Show>
                      </button>
                    );
                  }}
                </For>
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors border-t border-gray-600"
                  style={{ color: "var(--text-muted)", "border-top": "1px solid var(--border-muted)", "margin-top": "8px", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  onClick={loadOllamaModels}
                  disabled={loadingOllamaModels()}
                >
                  🔄 Refresh Models
                </button>
              </Show>
            </Show>

            <Show when={settings().aiProvider === "openrouter"}>
              <Show when={filteredModels().length === 0 && !fetchingModels()}>
                <div style={{ padding: "32px", "text-align": "center", color: "var(--text-muted)", "font-size": "13px" }}>No models found</div>
              </Show>
              <Show when={fetchingModels()}>
                <div style={{ padding: "32px", "text-align": "center", color: "var(--text-muted)", "font-size": "12px" }}>Loading models from OpenRouter...</div>
              </Show>
              <For each={filteredModels()}>
                {(m: OpenRouterModel) => {
                  const priceIn = m.pricing ? formatPrice(m.pricing.prompt) : null;
                  const priceOut = m.pricing ? formatPrice(m.pricing.completion) : null;
                  const isFree = !parseFloat(m.pricing?.prompt || "0");
                  const ctxK = m.context_length ? (m.context_length >= 1_000_000 ? `${(m.context_length/1_000_000).toFixed(0)}M` : `${Math.round(m.context_length/1000)}K`) : null;
                  const provider = modelProviderLabel(m.id);
                  const shortName = (m.name || m.id).replace(/^[^:]+:\s*/, "");
                  const hasVision = m.architecture?.input_modalities?.includes("image");
                  const hasThinking = m.supported_parameters?.includes("reasoning") || m.id.includes("thinking") || m.id.includes("r1") || m.id.includes("deepseek-r");
                  const hasTools = m.supported_parameters?.includes("tools");
                  const hasStructured = m.supported_parameters?.includes("structured_outputs");
                  const isLongCtx = (m.context_length || 0) >= 128_000;
                  const isActive = () => settings().aiModel === m.id;
                  const isHovered = () => hoveredModel() === m.id;
                  // Short desc for collapsed, full for hovered
                  const shortDesc = m.description ? m.description.replace(/\n+/g, " ").slice(0, 100) + (m.description.length > 100 ? "…" : "") : "";
                  const fullDesc = m.description ? m.description.replace(/\n+/g, " ") : "";

                  return (
                    <button
                      class="w-full rounded-lg px-3 py-2.5"
                      style={{
                        background: isActive()
                          ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)"
                          : isHovered() ? "var(--bg-hover)" : "var(--bg-base)",
                        border: isActive()
                          ? "1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)"
                          : isHovered() ? "1px solid var(--border-default)" : "1px solid var(--border-muted)",
                        cursor: "pointer", "text-align": "left", "margin-bottom": "4px",
                        display: "block", transition: "background 0.1s, border-color 0.1s",
                      }}
                      onMouseEnter={() => setHoveredModel(m.id)}
                      onMouseLeave={() => setHoveredModel(null)}
                      onClick={() => { handleModelChange(m.id); setModelDropdownOpen(false); setModelSearch(""); }}
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
                        {/* Capability badges */}
                        <Show when={hasThinking}>
                          <span title="Reasoning / thinking mode" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>🧠</span>
                        </Show>
                        <Show when={hasVision}>
                          <span title="Accepts image inputs" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>📷</span>
                        </Show>
                        <Show when={isFree}>
                          <span title="Free to use" style={{ "font-size": `${fontSize()}px`, "line-height": "1", "flex-shrink": "0" }}>🆓</span>
                        </Show>
                        {/* Price */}
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
            </Show>
          </div>

          {/* Footer count */}
          <div style={{ padding: "5px 12px", "border-top": "1px solid var(--border-muted)", "font-size": "10px", color: "var(--text-muted)", display: "flex", "justify-content": "space-between" }}>
            <span>{filteredModels().length} models</span>
            <Show when={settings().aiProvider === "openrouter" && openRouterModels().length > 0}>
              <span>per 1M tokens · live from openrouter.ai</span>
            </Show>
          </div>
        </div>
      </Show>

      {/* Messages */}
      <div class="flex-1 min-h-0 overflow-y-auto py-2" style={{ "padding-bottom": agentStreaming() ? "56px" : "12px" }}>
        <Show
          when={agentMessages.length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-3 px-6">
              <div
                class="rounded-full p-3"
                style={{ background: "var(--bg-hover)" }}
              >
                <SparkleIcon />
              </div>
              <Show
                when={hasApiKey() || settings().aiProvider === "ollama"}
                fallback={
                  <>
                    <p
                      class="text-center"
                      style={{ color: "var(--text-primary)", "font-size": "14px", "font-weight": "500" }}
                    >
                      Set your API key to get started
                    </p>
                    <p
                      class="text-center"
                      style={{ color: "var(--text-muted)", "font-size": "12px", "line-height": "1.5" }}
                    >
                      Pick a provider above, then click the
                      <span style={{ color: "var(--accent-yellow)" }}> key icon </span>
                      to enter your API key.
                    </p>
                    <Show when={settings().aiProvider === "openrouter"}>
                      <p
                        class="text-center"
                        style={{ color: "var(--text-muted)", "font-size": "11px" }}
                      >
                        Get a key at openrouter.ai
                      </p>
                    </Show>
                  </>
                }
              >
                <p
                  class="text-center"
                  style={{ color: "var(--text-muted)", "font-size": "13px" }}
                >
                  <Show when={clifInitializing()}
                    fallback="Ask the agent to help with your code. It can read files, search, edit, and run commands."
                  >
                    Scanning your codebase in the background...
                  </Show>
                </p>
                <Show when={!projectRoot()}>
                  <p
                    class="text-center"
                    style={{
                      color: "var(--accent-yellow)",
                      "font-size": "12px",
                    }}
                  >
                    Open a project folder to enable file tools.
                  </p>
                </Show>
              </Show>
            </div>
          }
        >
          <For each={agentMessages}>
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

      {/* ── Feature #1: Files In Context Panel ─────────────────────────── */}
      <Show when={contextFiles().length > 0}>
        {(() => {
          const [collapsed, setCollapsed] = createSignal(false);
          const root = () => projectRoot() || "";
          return (
            <div
              class="shrink-0"
              style={{ "border-top": "1px solid var(--border-muted)" }}
            >
              {/* Header row */}
              <button
                class="flex items-center gap-1.5 w-full px-3 py-1"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  "font-size": `${fontSize() - 3}px`,
                  "font-weight": "600",
                  "letter-spacing": "0.04em",
                  "text-transform": "uppercase",
                }}
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed() ? "Show context files" : "Collapse context files"}
              >
                {/* Chevron */}
                <svg
                  width="9" height="9" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                  style={{ transform: collapsed() ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s" }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>In Context</span>
                <span
                  class="rounded-full px-1.5"
                  style={{
                    background: "var(--bg-active)",
                    color: "var(--accent-primary)",
                    "font-size": `${fontSize() - 4}px`,
                    "font-weight": "700",
                  }}
                >
                  {contextFiles().length}
                </span>
              </button>

              {/* File list */}
              <Show when={!collapsed()}>
                <div class="flex flex-col pb-1">
                  <For each={contextFiles()}>
                    {(path) => {
                      const relPath = () =>
                        path.startsWith(root()) ? path.slice(root().length + 1) : path;
                      const fileName = () => path.split("/").pop() || path;
                      return (
                        <div
                          class="flex items-center gap-2 px-3 py-0.5 group"
                          style={{
                            "font-size": `${fontSize() - 2}px`,
                            "font-family": "var(--font-mono, monospace)",
                          }}
                        >
                          {/* File icon */}
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                            stroke="var(--accent-primary)" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round"
                            style={{ "flex-shrink": "0" }}
                          >
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                            <polyline points="13 2 13 9 20 9" />
                          </svg>
                          {/* Filename (bold) + directory (muted) */}
                          <span
                            class="truncate flex-1"
                            style={{ color: "var(--text-secondary)" }}
                            title={relPath()}
                          >
                            <span style={{ color: "var(--text-primary)", "font-weight": "500" }}>
                              {fileName()}
                            </span>
                            <Show when={relPath() !== fileName()}>
                              <span style={{ color: "var(--text-muted)", "font-size": "0.85em" }}>
                                {" · " + relPath().slice(0, relPath().lastIndexOf("/"))}
                              </span>
                            </Show>
                          </span>
                          {/* Remove button */}
                          <button
                            class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--text-muted)",
                              padding: "0 2px",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent-red)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
                            onClick={() => removeContextFile(path)}
                            title="Remove from context"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" stroke-width="3" stroke-linecap="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>

              {/* Compact chips row (shown when collapsed) */}
              <Show when={collapsed()}>
                <div class="flex flex-wrap gap-1 px-3 pb-1.5">
                  <For each={contextFiles()}>
                    {(path) => (
                      <ContextChip
                        label={path.split("/").pop() || path}
                        type="file"
                        onRemove={() => removeContextFile(path)}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </div>
          );
        })()}
      </Show>

      {/* @ mention dropdown */}
      <Show when={mentionActive() && mentionSuggestions().length > 0}>
        <div
          class="shrink-0 mx-3 mb-1 rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            "box-shadow": "0 -4px 16px rgba(0,0,0,0.2)",
            "max-height": "200px",
            "overflow-y": "auto",
          }}
        >
          <For each={mentionSuggestions()}>
            {(path, i) => (
              <button
                class="flex items-center gap-2 w-full px-3 py-1.5 text-left"
                style={{
                  background: i() === mentionIndex() ? "var(--bg-hover)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  "font-size": `${fontSize() - 1}px`,
                  "font-family": "var(--font-mono, monospace)",
                }}
                onMouseEnter={() => setMentionIndex(i())}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(path);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                <span class="truncate">{path}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Input area */}
      <div
        class="shrink-0 px-3 py-2"
        style={{ "border-top": "1px solid var(--border-default)" }}
      >
        <div
          class="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-default)",
          }}
        >
          {/* Attach file button */}
          <button
            class="flex items-center justify-center shrink-0 rounded p-1 mb-0.5"
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
              opacity: queuedMessage() ? "0.6" : "1",
            }}
            placeholder={
              queuedMessage()
                ? `Queued: "${queuedMessage()!.slice(0, 40)}${queuedMessage()!.length > 40 ? "…" : ""}"`
                : (agentStreaming() || clifInitializing())
                ? "Type to queue next message..."
                : "Ask the agent..."
            }
            rows={1}
            value={inputValue()}
            onInput={(e) => {
              if (queuedMessage()) return;
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
          />

          {/* Send / Stop streaming button */}
          <Show
            when={!agentStreaming()}
            fallback={
              <Show
                when={inputValue().trim()}
                fallback={
                  <button
                    class="flex items-center justify-center shrink-0 rounded-lg p-1.5 mb-0.5 transition-colors"
                    style={{
                      background: "color-mix(in srgb, var(--accent-red) 12%, transparent)",
                      color: "var(--accent-red)",
                      border: "1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)",
                      cursor: "pointer",
                    }}
                    onClick={stopAgent}
                    title="Stop streaming response"
                  >
                    <StopIcon />
                  </button>
                }
              >
                {/* Queue button — send after agent finishes */}
                <button
                  class="flex items-center justify-center shrink-0 rounded-lg p-1.5 mb-0.5 transition-colors"
                  style={{
                    background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)",
                    color: "var(--accent-primary)",
                    border: "1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)",
                    cursor: "pointer",
                  }}
                  onClick={handleSend}
                  title="Queue message — sends when agent finishes"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
                  </svg>
                </button>
              </Show>
            }
          >
            <button
              class="flex items-center justify-center shrink-0 rounded-lg p-1.5 mb-0.5 transition-colors"
              style={{
                background: inputValue().trim()
                  ? "var(--accent-primary)"
                  : "var(--bg-hover)",
                color: inputValue().trim() ? "#fff" : "var(--text-muted)",
                border: "none",
                cursor: inputValue().trim() ? "pointer" : "default",
              }}
              onClick={handleSend}
              disabled={!inputValue().trim()}
              title="Send message"
            >
              <SendIcon />
            </button>
          </Show>
        </div>
        <div
          class="flex items-center justify-between mt-1 px-1"
          style={{ "font-size": `${fontSize() - 4}px`, color: "var(--text-muted)" }}
        >
          {/* Left: status or hint */}
          <Show when={agentStreaming()}
            fallback={<span>Enter to send, Shift+Enter for newline</span>}
          >
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block animate-pulse"
                style={{ width: "5px", height: "5px", "border-radius": "50%", background: "var(--accent-yellow)", "flex-shrink": "0" }}
              />
              <span>Agent running</span>
              <button
                class="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
                style={{
                  background: "transparent", color: "var(--text-muted)",
                  border: "1px solid var(--border-default)", cursor: "pointer",
                  "font-size": `${fontSize() - 4}px`, "font-weight": "600",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--accent-red) 10%, transparent)";
                  (e.currentTarget as HTMLElement).style.color = "var(--accent-red)";
                  (e.currentTarget as HTMLElement).style.borderColor = "color-mix(in srgb, var(--accent-red) 25%, transparent)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
                }}
                onClick={stopAgent}
                title="Stop all agent tasks"
              >
                <StopIcon />
                Stop
              </button>
            </div>
          </Show>
          <div class="flex items-center gap-2">
            {/* Web search toggle */}
            <Show when={settings().aiProvider === "openrouter"}>
              <button
                class="flex items-center gap-1 rounded px-1.5 py-0.5 transition-all"
                style={{
                  background: webSearchEnabled()
                    ? "color-mix(in srgb, var(--accent-blue) 15%, transparent)"
                    : "transparent",
                  color: webSearchEnabled() ? "var(--accent-blue)" : "var(--text-muted)",
                  border: webSearchEnabled()
                    ? "1px solid color-mix(in srgb, var(--accent-blue) 30%, transparent)"
                    : "1px solid transparent",
                  cursor: "pointer",
                  "font-size": `${fontSize() - 4}px`,
                  "font-family": "var(--font-sans)",
                }}
                onMouseEnter={(e) => { if (!webSearchEnabled()) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!webSearchEnabled()) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                onClick={() => setWebSearchEnabled(!webSearchEnabled())}
                title={webSearchEnabled()
                  ? "Web search ON — model will fetch live results ($0.004/search)"
                  : "Enable web search — appends :online to model via OpenRouter"}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                {webSearchEnabled() ? "Search on" : "Search"}
              </button>
            </Show>
            <Show when={agentTokens().prompt > 0}>
              <span style={{ "font-family": "var(--font-mono, monospace)" }}>
                {(() => {
                  const t = agentTokens();
                  const total = t.prompt + t.completion;
                  const cost = (t.prompt * 3 + t.completion * 15) / 1_000_000;
                  const totalStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
                  return `${totalStr} tokens · ~$${cost.toFixed(4)}`;
                })()}
              </span>
            </Show>
          </div>
        </div>
      </div>

      {/* Markdown styles scoped to agent panel */}
      <style>{`
        .agent-markdown p { margin: 0.4em 0; }
        .agent-markdown p:first-child { margin-top: 0; }
        .agent-markdown p:last-child { margin-bottom: 0; }
        .agent-markdown code {
          font-family: var(--font-mono, monospace);
          font-size: 0.85em;
          padding: 0.15em 0.35em;
          border-radius: 4px;
          background: var(--bg-hover);
        }
        .agent-markdown table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.6em 0;
          font-size: 0.9em;
          overflow-x: auto;
          display: block;
        }
        .agent-markdown th, .agent-markdown td {
          border: 1px solid var(--border-default);
          padding: 6px 10px;
          text-align: left;
          white-space: nowrap;
        }
        .agent-markdown th {
          background: var(--bg-hover);
          font-weight: 600;
          color: var(--text-primary);
        }
        .agent-markdown tr:nth-child(even) td {
          background: color-mix(in srgb, var(--bg-hover) 50%, transparent);
        }
        .agent-markdown tr:hover td {
          background: var(--bg-hover);
        }
        .agent-markdown pre {
          margin: 0.5em 0;
          padding: 0.6em;
          border-radius: 6px;
          overflow-x: auto;
          background: var(--bg-base);
          border: 1px solid var(--border-muted);
        }
        .agent-markdown pre code {
          padding: 0;
          background: none;
          font-size: 0.8em;
        }
        .agent-markdown ul, .agent-markdown ol {
          margin: 0.4em 0;
          padding-left: 1.5em;
        }
        .agent-markdown li { margin: 0.15em 0; }
        .agent-markdown blockquote {
          margin: 0.5em 0;
          padding: 0.3em 0.8em;
          border-left: 3px solid var(--accent-primary);
          color: var(--text-secondary);
        }
        .agent-markdown h1, .agent-markdown h2, .agent-markdown h3 {
          margin: 0.5em 0 0.3em;
          font-weight: 600;
        }
        .agent-markdown h1 { font-size: 1.2em; }
        .agent-markdown h2 { font-size: 1.1em; }
        .agent-markdown h3 { font-size: 1em; }
        .agent-markdown,
        .agent-markdown * {
          user-select: text !important;
          -webkit-user-select: text !important;
        }
      `}</style>
    </div>
  );
};

export default AgentChatPanel;
