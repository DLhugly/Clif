export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface AiConfig {
  provider: "openrouter" | "ollama" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}
