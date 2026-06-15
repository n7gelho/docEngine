import type { ParsedDocument } from "@/lib/parsing/parse-document";
import type { DealType, DocumentType } from "@/lib/db/schema";
import { getClassificationMode } from "@/lib/ai/config";
import {
  buildLlmClassificationText,
  classifyDocumentWithLlm,
} from "@/lib/extraction/classify-document-llm";
import type { ExtractionTraceCollector } from "@/lib/extraction/extraction-trace";
import { HEURISTIC_MODEL } from "@/lib/extraction/pipeline/context";
import type { ExtractionPipelineContext } from "@/lib/extraction/pipeline/context";

const LOI_ALIASES = [
  "letter of intent",
  "heads of terms",
  "term sheet",
  "memorandum of understanding",
  "indicative offer",
];

const OLA_ALIASES = [
  "operating lease agreement",
  "operating lease",
  "aircraft lease agreement",
  "lease agreement",
  "aircraft purchase agreement",
  "aircraft sale agreement",
  "sale and purchase agreement",
  "sale agreement",
  "definitive agreement",
  "master lease agreement",
  "master lease",
  "lease supplement",
];

export type IngestionClassification = {
  dealType: DealType;
  documentType: DocumentType;
  method: "llm" | "heuristic" | "filename";
  confidence?: string;
  model?: string;
};

/** Header slice for type detection — not the metadata-scored section picker. */
export function buildClassificationText(parsed: ParsedDocument): string {
  return parsed.fullText.slice(0, 18_000);
}

function inferDealType(sample: string): DealType {
  const isPurchase =
    sample.includes("purchase agreement") ||
    sample.includes("sale agreement") ||
    sample.includes("sale and purchase") ||
    /letter of intent to purchase|intent to purchase|offer to purchase/i.test(
      sample
    ) ||
    (sample.includes("seller") && sample.includes("buyer")) ||
    (sample.includes("seller") && sample.includes("purchaser")) ||
    (sample.includes("buyer") && sample.includes("purchaser"));
  return isPurchase ? "PURCHASE" : "LEASE";
}

function hasLoiSignals(sample: string): boolean {
  return (
    /\bloi\b/.test(sample) || LOI_ALIASES.some((alias) => sample.includes(alias))
  );
}

function hasOlaSignals(sample: string): boolean {
  if (OLA_ALIASES.some((alias) => sample.includes(alias))) return true;
  if (/aircraft lease/i.test(sample)) return true;

  const hasLessor =
    /\(as lessor\)/i.test(sample) || /\bas lessor\b/i.test(sample);
  const hasLessee =
    /\(as lessee\)/i.test(sample) || /\bas lessee\b/i.test(sample);
  if (hasLessor && hasLessee) return true;

  return false;
}

export function classifyFromFilename(filename: string): {
  dealType: DealType;
  documentType: DocumentType;
} | null {
  const lower = filename.toLowerCase();

  if (/\[lease/.test(lower) || /\blease agreement\b/.test(lower)) {
    return { dealType: "LEASE", documentType: "OLA" };
  }

  if (
    /\[purchase/.test(lower) ||
    /\bpurchase agreement\b/.test(lower) ||
    /\bsale agreement\b/.test(lower)
  ) {
    return { dealType: "PURCHASE", documentType: "OLA" };
  }

  const isLoiFilename =
    /(?:^|[_\-.])loi(?:[_\-.]|$)|letter.of.intent|heads.of.terms|term.sheet/.test(
      lower
    );
  if (!isLoiFilename) return null;

  // Only skip LLM when deal type is explicit in the filename
  if (/purchase|sale/.test(lower)) {
    return { dealType: "PURCHASE", documentType: "LOI" };
  }
  if (/lease/.test(lower)) {
    return { dealType: "LEASE", documentType: "LOI" };
  }

  return null;
}

/** Regex-based hints for deal type / document type. */
export function classifyDocumentHeuristic(
  text: string,
  filename?: string
): {
  dealType: DealType;
  documentType: DocumentType;
} {
  const sample = text.slice(0, 18_000).toLowerCase();
  const dealType = inferDealType(sample);
  const loi = hasLoiSignals(sample);
  const ola = hasOlaSignals(sample);

  if (ola && !loi) {
    return { dealType, documentType: "OLA" };
  }

  if (loi && !ola) {
    return { dealType, documentType: "LOI" };
  }

  if (ola && loi) {
    const header = sample.slice(0, 4_000);
    const strongLoiHeader =
      /letter of intent|heads of terms|term sheet|memorandum of understanding|indicative offer/i.test(
        header
      );
    if (strongLoiHeader) {
      return { dealType, documentType: "LOI" };
    }

    const definitive =
      /(?:^|\n)\s*(?:aircraft\s+)?(?:operating\s+)?lease agreement|(?:^|\n)\s*(?:aircraft\s+)?(?:sale and )?purchase agreement|master lease agreement|\(as lessor\)|\(as lessee\)|as lessor|as lessee|lease supplement/i.test(
        sample
      );
    return { dealType, documentType: definitive ? "OLA" : "LOI" };
  }

  const fromFilename = filename ? classifyFromFilename(filename) : null;
  if (fromFilename) return fromFilename;

  return { dealType, documentType: "OTHER" };
}

function resolveHeuristicFallback(
  heuristic: { dealType: DealType; documentType: DocumentType },
  filename: string
): IngestionClassification | null {
  if (heuristic.documentType !== "OTHER") {
    return {
      dealType: heuristic.dealType,
      documentType: heuristic.documentType,
      method: "heuristic",
      confidence: "medium",
      model: HEURISTIC_MODEL,
    };
  }

  const fromFilename = classifyFromFilename(filename);
  if (fromFilename) {
    return { ...fromFilename, method: "filename", model: HEURISTIC_MODEL };
  }

  return null;
}

/** In auto mode, skip classification LLM only when filename rules are confident. */
function shouldSkipClassificationLlm(
  filename: string
): IngestionClassification | null {
  const fromFilename = classifyFromFilename(filename);
  if (!fromFilename) return null;

  return {
    ...fromFilename,
    method: "filename",
    confidence: "high",
    model: HEURISTIC_MODEL,
  };
}

/**
 * Classify document: LLM providers first (pinned per run), rules/filename when
 * auto mode is confident, heuristic/filename as last resort if all LLMs fail.
 */
export async function classifyDocumentForIngestion(
  parsed: ParsedDocument,
  filename: string,
  ctx: ExtractionPipelineContext,
  trace?: ExtractionTraceCollector
): Promise<IngestionClassification> {
  const mode = getClassificationMode();
  const headerText = buildClassificationText(parsed);
  const heuristic = classifyDocumentHeuristic(headerText, filename);
  const llmInput = buildLlmClassificationText(parsed.fullText, filename);

  if (mode === "heuristic") {
    const resolved = resolveHeuristicFallback(heuristic, filename);
    if (!resolved) {
      throw new Error("Document classification failed: unable to classify from rules");
    }
    trace?.recordClassification({
      text: headerText,
      dealType: resolved.dealType,
      documentType: resolved.documentType,
      method: resolved.method,
      confidence: resolved.confidence ?? "low",
      model: resolved.model,
    });
    return resolved;
  }

  if (mode === "auto") {
    const skip = shouldSkipClassificationLlm(filename);
    if (skip) {
      trace?.recordClassification({
        text: headerText,
        dealType: skip.dealType,
        documentType: skip.documentType,
        method: skip.method,
        confidence: skip.confidence ?? "high",
        model: skip.model,
        note: "skipped LLM — confident filename match",
      });
      return skip;
    }
  }

  try {
    const llm = await classifyDocumentWithLlm(parsed.fullText, filename, ctx);
    trace?.recordClassification({
      text: llmInput,
      model: llm.model,
      dealType: llm.dealType,
      documentType: llm.documentType,
      method: "llm",
      confidence: llm.confidence,
      signals: llm.signals,
    });
    return {
      dealType: llm.dealType,
      documentType: llm.documentType,
      method: "llm",
      confidence: llm.confidence,
      model: llm.model,
    };
  } catch (error) {
    const fallback = resolveHeuristicFallback(heuristic, filename);
    if (!fallback) throw error;

    trace?.recordClassification({
      text: headerText,
      dealType: fallback.dealType,
      documentType: fallback.documentType,
      method: fallback.method,
      confidence: fallback.confidence ?? "low",
      model: fallback.model,
      note: `LLM failed — used ${fallback.method} fallback`,
      error: error instanceof Error ? error.message : "classification failed",
    });
    return fallback;
  }
}
