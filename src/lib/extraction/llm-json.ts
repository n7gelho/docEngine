import {
  buildChatProviderChain,
  type ChatProviderId,
} from "@/lib/ai/config";
import { claudeChatJson } from "@/lib/ai/claude";
import { ollamaChatJson } from "@/lib/ai/ollama";
import { openaiChatJson } from "@/lib/ai/openai-chat";
import {
  CLASSIFICATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/extraction/prompt";

export type LlmJsonOptions = {
  systemPrompt?: string;
};

async function callChatProvider(
  provider: ChatProviderId,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; model: string }> {
  switch (provider) {
    case "claude":
      return claudeChatJson(systemPrompt, userPrompt);
    case "openai":
      return openaiChatJson(systemPrompt, userPrompt);
    case "ollama":
      return ollamaChatJson(systemPrompt, userPrompt);
  }
}

/**
 * Call the configured chat provider chain and return raw JSON text.
 * External providers (Claude, OpenAI) fall back to Ollama when enabled.
 */
export async function callLlmJson(
  userPrompt: string,
  options?: LlmJsonOptions
): Promise<{ content: string; model: string }> {
  const systemPrompt = options?.systemPrompt ?? EXTRACTION_SYSTEM_PROMPT;
  const chain = buildChatProviderChain();
  const errors: string[] = [];

  for (const provider of chain) {
    try {
      return await callChatProvider(provider, systemPrompt, userPrompt);
    } catch (error) {
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : "request failed"}`
      );
    }
  }

  throw new Error(errors.join("; ") || "No AI provider available");
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseJsonContent(content: string): unknown {
  return JSON.parse(stripJsonFence(content));
}

export { CLASSIFICATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT };
