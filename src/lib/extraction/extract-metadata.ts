import {
  getAiProviderPreference,
  hasChatProviderAvailable,
} from "@/lib/ai/config";
import type { DealType, DocumentType } from "@/lib/db/schema";
import { classifyDocumentHeuristic } from "@/lib/extraction/classify-document";
import { ExtractionTraceCollector } from "@/lib/extraction/extraction-trace";
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
import { validateFieldsAgainstSource } from "@/lib/extraction/validate-extraction";
import {
  loiExtractionSchema,
  type ExtractionHint,
  type ExtractionOutcome,
  type LoiExtractionResult,
} from "@/lib/extraction/types";
import { getLoiProfile, SCHEMA_VERSION } from "@/lib/profiles/schema-registry";

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
  const validated = validateFieldsAgainstSource(
    result.fields as Record<string, ParsedFieldValue>,
    extractionText
  );
  return {
    result: { ...result, fields: validated },
    model,
  };
}

export async function extractLoiMetadata(
  extractionText: string,
  hint: ExtractionHint = {},
  trace?: ExtractionTraceCollector
): Promise<ExtractionOutcome> {
  const collector = trace ?? new ExtractionTraceCollector();
  const preference = getAiProviderPreference();
  const errors: string[] = [];
  const resolvedHint: ExtractionHint = {
    dealType: hint.dealType ?? classifyDocumentHeuristic(extractionText).dealType,
    documentType: "LOI",
  };

  const profile = getLoiProfile(resolvedHint.dealType ?? "LEASE");
  const fieldsTotal = profile.fields.length;

  const tryLlm =
    preference === "ollama" ||
    preference === "openai" ||
    preference === "claude" ||
    preference === "auto";

  if (tryLlm && hasChatProviderAvailable()) {
    try {
      const { result, model } = await extractLoiWithLlm(
        extractionText,
        resolvedHint
      );
      const filled = Object.values(result.fields).filter(
        (f) => f.value !== null && String(f.value).trim() !== ""
      ).length;
      collector.recordLlmExtraction({
        kind: "loi",
        label: "LOI extraction",
        text: extractionText,
        model,
        fieldsFilled: filled,
        fieldsTotal,
      });
      return {
        result,
        model,
        coverage: computeLoiCoverage(result.fields, result.dealType),
        trace: collector.toTrace(),
      };
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "LLM extraction failed"
      );
      if (
        preference === "ollama" ||
        preference === "openai" ||
        preference === "claude"
      ) {
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
  const filled = Object.values(result.fields).filter(
    (f) => f.value !== null && String(f.value).trim() !== ""
  ).length;
  collector.recordLlmExtraction({
    kind: "loi",
    label: "LOI extraction (heuristic fallback)",
    text: extractionText,
    model: "heuristic-v3",
    fieldsFilled: filled,
    fieldsTotal,
    error: errors.join("; ") || undefined,
  });
  return {
    result,
    model: "heuristic-v3",
    coverage: computeLoiCoverage(
      result.fields as Record<string, ParsedFieldValue>,
      dealType,
      errors
    ),
    trace: collector.toTrace(),
  };
}

