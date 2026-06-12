import {
  getAiProviderPreference,
  isOpenAiConfigured,
} from "@/lib/ai/config";
import type { DealType, DocumentType } from "@/lib/db/schema";
import { classifyDocumentHeuristic } from "@/lib/extraction/classify-document";
import {
  computeLoiCoverage,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import { extractLoiHeuristic } from "@/lib/extraction/loi-heuristic";
import { callLlmJson, parseJsonContent } from "@/lib/extraction/llm-json";
import {
  normalizeExtractionPayload,
  normalizeFieldMap,
  type ParsedFieldValue,
} from "@/lib/extraction/normalize-extraction";
import { buildLoiExtractionPrompt } from "@/lib/extraction/prompt";
import {
  loiExtractionSchema,
  type ExtractionHint,
  type ExtractionOutcome,
  type LoiExtractionResult,
} from "@/lib/extraction/types";
import { SCHEMA_VERSION } from "@/lib/profiles/schema-registry";

export { SCHEMA_VERSION };
export type {
  ExtractionHint,
  ExtractionOutcome,
  ExtractionResult,
  LoiExtractionResult,
  OlaExtractionResult,
} from "@/lib/extraction/types";
export type { ExtractionCoverage } from "@/lib/extraction/extraction-coverage";

function parseLoiJson(raw: unknown, hint: ExtractionHint): LoiExtractionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid extraction JSON");
  }

  const normalized = normalizeExtractionPayload(raw) as Record<string, unknown>;
  const documentType =
    (normalized.documentType as DocumentType) ?? hint.documentType ?? "LOI";

  if (normalized.fields) {
    return loiExtractionSchema.parse({
      ...normalized,
      documentType: documentType === "OLA" ? "LOI" : documentType,
    });
  }

  const flatFields = normalizeFieldMap(normalized as Record<string, unknown>);
  return loiExtractionSchema.parse({
    dealType: (normalized.dealType as DealType) ?? hint.dealType ?? "LEASE",
    documentType: "LOI",
    fields: flatFields,
  });
}

async function extractLoiWithLlm(
  extractionText: string,
  hint: ExtractionHint
): Promise<{ result: LoiExtractionResult; model: string }> {
  const dealType = hint.dealType ?? "LEASE";
  const { content, model } = await callLlmJson(
    buildLoiExtractionPrompt(extractionText, dealType)
  );
  const result = parseLoiJson(parseJsonContent(content), hint);
  return { result, model };
}

export async function extractLoiMetadata(
  extractionText: string,
  hint: ExtractionHint = {}
): Promise<ExtractionOutcome> {
  const preference = getAiProviderPreference();
  const errors: string[] = [];
  const resolvedHint: ExtractionHint = {
    dealType: hint.dealType ?? classifyDocumentHeuristic(extractionText).dealType,
    documentType: "LOI",
  };

  const tryLlm =
    preference === "ollama" ||
    preference === "openai" ||
    preference === "auto";

  if (tryLlm && (preference !== "openai" || isOpenAiConfigured())) {
    try {
      const { result, model } = await extractLoiWithLlm(
        extractionText,
        resolvedHint
      );
      return {
        result,
        model,
        coverage: computeLoiCoverage(result.fields, result.dealType),
      };
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "LLM extraction failed"
      );
      if (preference === "ollama" || preference === "openai") {
        throw new Error(errors.join("; "));
      }
    }
  }

  if (errors.length > 0) {
    console.warn(
      `[extractLoiMetadata] Falling back to heuristic: ${errors.join("; ")}`
    );
  }

  const dealType = resolvedHint.dealType ?? "LEASE";
  const result = extractLoiHeuristic(extractionText, dealType);
  return {
    result,
    model: "heuristic-v3",
    coverage: computeLoiCoverage(
      result.fields as Record<string, ParsedFieldValue>,
      dealType,
      errors
    ),
  };
}
