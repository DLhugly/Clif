// AI provider abstraction - will be expanded in Phase 2

#[derive(Debug, Clone, PartialEq)]
pub enum Provider {
    OpenRouter,
    Ollama,
}

impl Provider {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "ollama" => Provider::Ollama,
            _ => Provider::OpenRouter,
        }
    }

    pub fn base_url(&self) -> &str {
        match self {
            Provider::OpenRouter => "https://openrouter.ai/api/v1",
            Provider::Ollama => "http://localhost:11434/v1",
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Provider::OpenRouter => "openrouter",
            Provider::Ollama => "ollama",
        }
    }
}
