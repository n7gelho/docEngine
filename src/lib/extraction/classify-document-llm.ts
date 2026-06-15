import type { DealType, DocumentType } from "@/lib/db/schema";
import { hasChatProviderAvailable } from "@/lib/ai/config";
import { callLlmJson, parseJsonContent } from "@/lib/extraction/llm-json";
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
  filename: string
): Promise<LlmClassificationResult | null> {
  if (!hasChatProviderAvailable()) return null;

  try {
    const input = buildLlmClassificationText(fullText, filename);
    const { content, model } = await callLlmJson(buildClassificationPrompt(input), {
      systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
    });
    const raw = parseJsonContent(content) as Record<string, unknown>;

    const documentType = normalizeDocumentType(raw.documentType);
    const dealType = normalizeDealType(raw.dealType);
    if (!documentType || !dealType) return null;

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
  } catch {
    return null;
  }
}
