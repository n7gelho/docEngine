import {
  getOllamaBaseUrl,
  getOllamaChatModel,
  getOllamaEmbeddingModel,
} from "@/lib/ai/config";

type OllamaTagsResponse = {
  models?: Array<{ name: string }>;
};

type OllamaChatResponse = {
  message?: { content?: string };
};

type OllamaEmbedResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

let cachedModelNames: string[] | null = null;

export async function listOllamaModels(): Promise<string[]> {
  if (cachedModelNames) return cachedModelNames;

  const baseUrl = getOllamaBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/tags`, {
    method: "GET",
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Failed to list Ollama models (${response.status})`);
  }

  const data = (await response.json()) as OllamaTagsResponse;
  cachedModelNames = (data.models ?? []).map((model) => model.name);
  return cachedModelNames;
}

export async function resolveOllamaChatModel(): Promise<string> {
  const preferred = getOllamaChatModel();
  const installed = await listOllamaModels();

  if (installed.includes(preferred)) return preferred;

  const candidates = [
    preferred,
    preferred.split(":")[0],
    "llama3.1:8b",
    "llama3.1",
    "llama3:latest",
    "llama3",
    "mistral:latest",
  ];

  for (const candidate of candidates) {
    const match = installed.find(
      (name) => name === candidate || name.startsWith(`${candidate}:`)
    );
    if (match) return match;
  }

  const llamaMatch = installed.find((name) => name.toLowerCase().includes("llama"));
  if (llamaMatch) return llamaMatch;

  throw new Error(
    `Ollama chat model "${preferred}" is not installed. Available: ${installed.join(", ") || "none"}`
  );
}

export async function resolveOllamaEmbeddingModel(): Promise<string> {
  const preferred = getOllamaEmbeddingModel();
  const installed = await listOllamaModels();

  if (installed.includes(preferred)) return preferred;

  const candidates = [
    preferred,
    "nomic-embed-text",
    "mxbai-embed-large",
    "all-minilm",
  ];

  for (const candidate of candidates) {
    const match = installed.find(
      (name) => name === candidate || name.startsWith(`${candidate}:`)
    );
    if (match) return match;
  }

  throw new Error(
    `Ollama embedding model "${preferred}" is not installed. Run: ollama pull nomic-embed-text`
  );
}

async function ollamaFetch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const baseUrl = getOllamaBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama request failed (${response.status}): ${errorText.slice(0, 300)}`
    );
  }

  return response.json() as Promise<T>;
}

export async function ollamaChatJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; model: string }> {
  const model = await resolveOllamaChatModel();
  const data = await ollamaFetch<OllamaChatResponse>("/api/chat", {
    model,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      temperature: 0.1,
    },
  });

  const content = data.message?.content;
  if (!content) {
    throw new Error("Empty response from Ollama chat model");
  }

  return { content, model: `ollama:${model}` };
}

export async function ollamaEmbedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const model = await resolveOllamaEmbeddingModel();
  const input = texts.map((text) => text.slice(0, 8000));

  const data = await ollamaFetch<OllamaEmbedResponse>("/api/embed", {
    model,
    input: input.length === 1 ? input[0] : input,
  });

  if (data.embeddings && data.embeddings.length > 0) {
    return data.embeddings;
  }

  if (data.embedding) {
    return [data.embedding];
  }

  throw new Error("Empty embedding response from Ollama");
}

export async function checkOllamaReachable(): Promise<boolean> {
  try {
    await listOllamaModels();
    return true;
  } catch {
    return false;
  }
}

export function clearOllamaModelCache() {
  cachedModelNames = null;
}
