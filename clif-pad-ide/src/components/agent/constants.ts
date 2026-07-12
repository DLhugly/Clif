// Agent panel constants & types — extracted from AgentChatPanel.tsx

export const POPULAR_MODELS: Record<string, { value: string; label: string }[]> = {
  openrouter: [
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "anthropic/claude-haiku-4", label: "Claude Haiku 4" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash" },
    { value: "deepseek/deepseek-chat-v3", label: "DeepSeek V3" },
  ],
};

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

export function formatPrice(priceStr: string): string {
  const n = parseFloat(priceStr);
  if (!n || isNaN(n)) return "free";
  const per1M = n * 1_000_000;
  return per1M < 1 ? `$${per1M.toFixed(2)}` : `$${per1M.toFixed(0)}`;
}

export function modelProviderLabel(id: string): string {
  const [vendor] = id.split("/");
  const map: Record<string, string> = {
    anthropic: "Anthropic", openai: "OpenAI", google: "Google",
    meta: "Meta", deepseek: "DeepSeek", mistralai: "Mistral",
    cohere: "Cohere", "x-ai": "xAI", qwen: "Qwen",
    "nvidia": "NVIDIA", "perplexity": "Perplexity",
  };
  return map[vendor] || vendor?.charAt(0).toUpperCase() + vendor?.slice(1) || "Other";
}
