import type { ChatProviderId } from "@/lib/ai/config";
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
import {
  getProvidersToTry,
  markProviderFailed,
  pinProvider,
  trackModel,
  type ExtractionPipelineContext,
} from "@/lib/extraction/pipeline/context";

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
 * Call LLM using the pipeline context (pinned provider per document).
 * Tries the provider chain once per unresolved provider; pins on first success.
 */
export async function callLlmInContext(
  ctx: ExtractionPipelineContext,
  userPrompt: string,
  options?: LlmJsonOptions
): Promise<{ content: string; model: string; provider: ChatProviderId }> {
  const systemPrompt = options?.systemPrompt ?? EXTRACTION_SYSTEM_PROMPT;
  const providers = getProvidersToTry(ctx);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const result = await callChatProvider(provider, systemPrompt, userPrompt);
      pinProvider(ctx, provider);
      trackModel(ctx.model, result.model);
      return { ...result, provider };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "request failed";
      errors.push(`${provider}: ${message}`);
      markProviderFailed(ctx, provider);
    }
  }

  throw new Error(errors.join("; ") || "No AI provider available");
}
