export type AiProviderPreference = "auto" | "ollama" | "openai";

export function getEmbeddingDimensions(): number {
  const parsed = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768", 10);
  return Number.isNaN(parsed) ? 768 : parsed;
}

export function getAiProviderPreference(): AiProviderPreference {
  const value = process.env.AI_PROVIDER?.toLowerCase();
  if (value === "ollama" || value === "openai") return value;
  return "auto";
}

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

export function getOllamaChatModel(): string {
  return process.env.OLLAMA_MODEL ?? "llama3:latest";
}

export function getOllamaEmbeddingModel(): string {
  return process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
}

export function isOpenAiConfigured(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  return Boolean(apiKey && !apiKey.startsWith("sk-your"));
}
