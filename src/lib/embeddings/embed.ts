import OpenAI from "openai";
import {
  getEmbeddingFallbackToOllama,
  getEmbeddingProviderPreference,
  getEmbeddingDimensions,
  isOpenAiConfigured,
  type EmbeddingProviderPreference,
} from "@/lib/ai/config";
import { ollamaEmbedTexts } from "@/lib/ai/ollama";

function getOpenAIClient(): OpenAI | null {
  if (!isOpenAiConfigured()) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function hashEmbed(text: string): number[] {
  const dimensions = getEmbeddingDimensions();
  const vector = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase();

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const idx = (code * (i + 1)) % dimensions;
    vector[idx] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

function normalizeEmbeddingDimensions(embedding: number[]): number[] {
  const dimensions = getEmbeddingDimensions();
  if (embedding.length === dimensions) return embedding;
  if (embedding.length > dimensions) {
    return embedding.slice(0, dimensions);
  }
  return [...embedding, ...new Array(dimensions - embedding.length).fill(0)];
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const embeddings = await ollamaEmbedTexts(texts);
  return embeddings.map(normalizeEmbeddingDimensions);
}

async function embedWithOpenAI(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error("OpenAI is not configured");
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const inputs = texts.map((t) => t.slice(0, 8000));
  const response = await client.embeddings.create({
    model,
    input: inputs,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => normalizeEmbeddingDimensions(item.embedding));
}

function buildEmbeddingChain(): EmbeddingProviderPreference[] {
  const preference = getEmbeddingProviderPreference();
  const fallbackToOllama = getEmbeddingFallbackToOllama();

  if (preference === "ollama") {
    return ["ollama"];
  }

  if (preference === "openai") {
    const chain: EmbeddingProviderPreference[] = [];
    if (isOpenAiConfigured()) chain.push("openai");
    if (fallbackToOllama) chain.push("ollama");
    return chain.length > 0 ? chain : ["ollama"];
  }

  // auto: local first, then cloud, then hash fallback in caller
  const chain: EmbeddingProviderPreference[] = ["ollama"];
  if (isOpenAiConfigured()) chain.push("openai");
  return chain;
}

async function embedTextsWithProviders(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const chain = buildEmbeddingChain();
  const errors: string[] = [];

  for (const provider of chain) {
    try {
      if (provider === "ollama") {
        return await embedWithOllama(texts);
      }
      return await embedWithOpenAI(texts);
    } catch (error) {
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : "request failed"}`
      );
    }
  }

  console.warn(
    `[embed] All embedding providers failed (${errors.join("; ")}); using hash fallback`
  );
  return texts.map(hashEmbed);
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTextsWithProviders([text]);
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return embedTextsWithProviders(texts);
}

export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
