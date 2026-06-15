import type { DealType, DocumentType } from "@/lib/db/schema";
import { hasChatProviderAvailable } from "@/lib/ai/config";
import { parseJsonContent } from "@/lib/extraction/llm-json";
import { callLlmInContext } from "@/lib/extraction/pipeline/llm-call";
import type { ExtractionPipelineContext } from "@/lib/extraction/pipeline/context";
import {
  buildClassificationPrompt,
  CLASSIFICATION_SYSTEM_PROMPT,
} from "@/lib/extraction/prompt";

export type ClassificationConfidence = "high" | "medium" | "low";

export type LlmClassificationResult = {
  dealType: DealType;
  documentType: DocumentType;
  confidence: ClassificationConfidence;
  signals: string[];
  model: string;
};

const CLASSIFICATION_HEADER_CHARS = 8_000;

function normalizeDocumentType(value: unknown): DocumentType | null {
  if (value === "LOI" || value === "OLA") return value;
  return null;
}

function normalizeDealType(value: unknown): DealType | null {
  if (value === "LEASE" || value === "PURCHASE") return value;
  return null;
}

function normalizeConfidence(value: unknown): ClassificationConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

export function buildLlmClassificationText(
  fullText: string,
  filename: string
): string {
  const header = fullText.slice(0, CLASSIFICATION_HEADER_CHARS);
  return `FILENAME: ${filename}\n\nDOCUMENT HEADER:\n${header}`;
}

export async function classifyDocumentWithLlm(
  fullText: string,
  filename: string,
  ctx: ExtractionPipelineContext
): Promise<LlmClassificationResult> {
  if (!hasChatProviderAvailable()) {
    throw new Error("No AI chat provider available for classification");
  }

  const input = buildLlmClassificationText(fullText, filename);
  const { content, model } = await callLlmInContext(
    ctx,
    buildClassificationPrompt(input),
    { systemPrompt: CLASSIFICATION_SYSTEM_PROMPT }
  );
  const raw = parseJsonContent(content) as Record<string, unknown>;

  const documentType = normalizeDocumentType(raw.documentType);
  const dealType = normalizeDealType(raw.dealType);
  if (!documentType || !dealType) {
    throw new Error("Classification LLM returned invalid document or deal type");
  }

  const signals = Array.isArray(raw.signals)
    ? raw.signals.filter((s): s is string => typeof s === "string")
    : [];

  return {
    dealType,
    documentType,
    confidence: normalizeConfidence(raw.confidence),
    signals,
    model,
  };
}
