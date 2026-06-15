import { callLlmInContext } from "@/lib/extraction/pipeline/llm-call";
import {
  createExtractionContext,
  type ExtractionPipelineContext,
} from "@/lib/extraction/pipeline/context";
import {
  CLASSIFICATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/extraction/prompt";

export type LlmJsonOptions = {
  systemPrompt?: string;
};

/**
 * One-off LLM call without pipeline context (scripts/diagnostics).
 * Prefer callLlmInContext during document ingestion.
 */
export async function callLlmJson(
  userPrompt: string,
  options?: LlmJsonOptions
): Promise<{ content: string; model: string }> {
  const ctx = createExtractionContext();
  const { content, model } = await callLlmInContext(ctx, userPrompt, options);
  return { content, model };
}

export { callLlmInContext, createExtractionContext, type ExtractionPipelineContext };

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseJsonContent(content: string): unknown {
  return JSON.parse(stripJsonFence(content));
}

export { CLASSIFICATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT };
