export type AiProviderPreference = "auto" | "ollama" | "openai" | "claude";

export type EmbeddingProviderPreference = "auto" | "ollama" | "openai";

export type ChatProviderId = "claude" | "openai" | "ollama";

export function getEmbeddingDimensions(): number {
  const parsed = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768", 10);
  return Number.isNaN(parsed) ? 768 : parsed;
}

export function getAiProviderPreference(): AiProviderPreference {
  const value = process.env.AI_PROVIDER?.toLowerCase();
  if (
    value === "ollama" ||
    value === "openai" ||
    value === "claude"
  ) {
    return value;
  }
  return "auto";
}

export function getEmbeddingProviderPreference(): EmbeddingProviderPreference {
  const value = process.env.AI_EMBEDDING_PROVIDER?.toLowerCase();
  if (value === "ollama" || value === "openai") return value;
  return "auto";
}

/** When true (default), failed external chat calls fall back to Ollama. */
export function getChatFallbackToOllama(): boolean {
  const value = process.env.AI_CHAT_FALLBACK_OLLAMA?.toLowerCase();
  if (value === "false" || value === "0" || value === "no") return false;
  return true;
}

/** When true (default), failed external embedding calls fall back to Ollama. */
export function getEmbeddingFallbackToOllama(): boolean {
  const value = process.env.AI_EMBEDDING_FALLBACK_OLLAMA?.toLowerCase();
  if (value === "false" || value === "0" || value === "no") return false;
  return true;
}

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

export function getOllamaChatModel(): string {
  return process.env.OLLAMA_MODEL ?? "llama3.1:8b";
}

export function getOllamaEmbeddingModel(): string {
  return process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
}

export function isOpenAiConfigured(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  return Boolean(apiKey && !apiKey.startsWith("sk-your"));
}

export function isClaudeConfigured(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return Boolean(apiKey && !apiKey.startsWith("sk-ant-your"));
}

export function getClaudeModel(): string {
  return process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
}

/** Ordered chat providers to try for the current AI_PROVIDER setting. */
export function buildChatProviderChain(): ChatProviderId[] {
  const preference = getAiProviderPreference();
  const fallbackToOllama = getChatFallbackToOllama();

  if (preference === "ollama") {
    return ["ollama"];
  }

  if (preference === "claude") {
    const chain: ChatProviderId[] = [];
    if (isClaudeConfigured()) chain.push("claude");
    if (fallbackToOllama) chain.push("ollama");
    return chain.length > 0 ? chain : ["ollama"];
  }

  if (preference === "openai") {
    const chain: ChatProviderId[] = [];
    if (isOpenAiConfigured()) chain.push("openai");
    if (fallbackToOllama) chain.push("ollama");
    return chain.length > 0 ? chain : ["ollama"];
  }

  // auto: prefer configured external providers, always end with Ollama
  const chain: ChatProviderId[] = [];
  if (isClaudeConfigured()) chain.push("claude");
  if (isOpenAiConfigured()) chain.push("openai");
  chain.push("ollama");
  return chain;
}

export function hasChatProviderAvailable(): boolean {
  return buildChatProviderChain().length > 0;
}
