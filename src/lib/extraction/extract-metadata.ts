import { hasChatProviderAvailable } from "@/lib/ai/config";
import type { DealType, DocumentType } from "@/lib/db/schema";
import { ExtractionTraceCollector } from "@/lib/extraction/extraction-trace";
import {
  computeLoiCoverage,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import { extractLoiHeuristic } from "@/lib/extraction/loi-heuristic";
import { parseJsonContent } from "@/lib/extraction/llm-json";
import { callLlmInContext } from "@/lib/extraction/pipeline/llm-call";
import {
  adoptHeuristicModel,
  HEURISTIC_MODEL,
  trackModel,
  type ExtractionPipelineContext,
} from "@/lib/extraction/pipeline/context";
import { resolveLoiDealType } from "@/lib/extraction/resolve-loi-deal-type";
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
  hint: ExtractionHint,
  ctx: ExtractionPipelineContext
): Promise<{ result: LoiExtractionResult; model: string }> {
  const dealType = hint.dealType ?? "LEASE";
  const { content, model } = await callLlmInContext(
    ctx,
    buildLoiExtractionPrompt(extractionText, dealType)
  );
  const result = parseLoiJson(parseJsonContent(content), hint);
  const validated = validateFieldsAgainstSource(
    result.fields as Record<string, ParsedFieldValue>,
    extractionText
  );
  trackModel(ctx.model, model);
  return {
    result: { ...result, fields: validated },
    model,
  };
}

export async function extractLoiMetadata(
  extractionText: string,
  hint: ExtractionHint = {},
  ctx: ExtractionPipelineContext,
  trace?: ExtractionTraceCollector,
  filename?: string
): Promise<ExtractionOutcome> {
  const collector = trace ?? new ExtractionTraceCollector();
  const dealType = resolveLoiDealType(
    hint.dealType,
    extractionText,
    filename
  );
  const resolvedHint: ExtractionHint = {
    dealType,
    documentType: "LOI",
  };
  const coverageWarnings: string[] = [];
  if (hint.dealType && hint.dealType !== dealType) {
    coverageWarnings.push(
      `Deal type corrected from ${hint.dealType} to ${dealType} using document text`
    );
  }

  const profile = getLoiProfile(dealType);
  const fieldsTotal = profile.fields.length;
  const llmErrors: string[] = [];

  if (hasChatProviderAvailable()) {
    try {
      const { result, model } = await extractLoiWithLlm(
        extractionText,
        resolvedHint,
        ctx
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
        coverage: computeLoiCoverage(result.fields, result.dealType, coverageWarnings),
        trace: collector.toTrace(),
      };
    } catch (error) {
      llmErrors.push(
        error instanceof Error ? error.message : "LLM extraction failed"
      );
    }
  } else {
    llmErrors.push("No AI chat provider available");
  }

  console.warn(
    `[extractLoiMetadata] Falling back to heuristic: ${llmErrors.join("; ")}`
  );

  const result = extractLoiHeuristic(extractionText, dealType);
  const model = adoptHeuristicModel(ctx.model);
  const filled = Object.values(result.fields).filter(
    (f) => f.value !== null && String(f.value).trim() !== ""
  ).length;
  collector.recordLlmExtraction({
    kind: "loi",
    label: "LOI extraction (heuristic fallback)",
    text: extractionText,
    model: HEURISTIC_MODEL,
    fieldsFilled: filled,
    fieldsTotal,
    error: llmErrors.join("; ") || undefined,
  });
  return {
    result,
    model,
    coverage: computeLoiCoverage(
      result.fields as Record<string, ParsedFieldValue>,
      dealType,
      [...coverageWarnings, ...llmErrors]
    ),
    trace: collector.toTrace(),
  };
}
