import type { ParsedDocument } from "@/lib/parsing/parse-document";
import type { DealType, DocumentType } from "@/lib/db/schema";
import {
  buildLlmClassificationText,
  classifyDocumentWithLlm,
} from "@/lib/extraction/classify-document-llm";
import type { ExtractionTraceCollector } from "@/lib/extraction/extraction-trace";

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
    (sample.includes("seller") && sample.includes("buyer")) ||
    (sample.includes("seller") && sample.includes("purchaser"));
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

  if (/\bloi\b|letter.of.intent|heads.of.terms|term.sheet/.test(lower)) {
    return {
      dealType: /purchase|sale/.test(lower) ? "PURCHASE" : "LEASE",
      documentType: "LOI",
    };
  }

  if (/\[lease|\blease agreement\b/.test(lower)) {
    return { dealType: "LEASE", documentType: "OLA" };
  }

  if (/\[purchase|\bpurchase agreement\b|\bsale agreement\b/.test(lower)) {
    return { dealType: "PURCHASE", documentType: "OLA" };
  }

  return null;
}

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
    const definitive =
      /lease agreement|purchase agreement|sale agreement|master lease|\(as lessor\)|\(as lessee\)|as lessor|as lessee|lease supplement/i.test(
        sample
      );
    return { dealType, documentType: definitive ? "OLA" : "LOI" };
  }

  const fromFilename = filename ? classifyFromFilename(filename) : null;
  if (fromFilename) return fromFilename;

  return { dealType, documentType: "OTHER" };
}

function resolveUnknownType(
  heuristic: { dealType: DealType; documentType: DocumentType },
  filename: string
): IngestionClassification {
  const fromFilename = classifyFromFilename(filename);
  if (fromFilename) {
    return { ...fromFilename, method: "filename" };
  }
  return {
    dealType: heuristic.dealType,
    documentType: "LOI",
    method: "heuristic",
    confidence: "low",
  };
}

/** Classify document for ingestion: LLM when available, heuristic/filename fallback. */
export async function classifyDocumentForIngestion(
  parsed: ParsedDocument,
  filename: string,
  trace?: ExtractionTraceCollector
): Promise<IngestionClassification> {
  const headerText = buildClassificationText(parsed);
  const heuristic = classifyDocumentHeuristic(headerText, filename);
  const llmInput = buildLlmClassificationText(parsed.fullText, filename);

  const llm = await classifyDocumentWithLlm(parsed.fullText, filename);

  if (llm && (llm.confidence === "high" || llm.confidence === "medium")) {
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
    };
  }

  if (llm && heuristic.documentType !== "OTHER") {
    const agree =
      llm.documentType === heuristic.documentType &&
      llm.dealType === heuristic.dealType;
    if (agree || llm.confidence === "low") {
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
      };
    }
  }

  if (llm && heuristic.documentType === "OTHER") {
    trace?.recordClassification({
      text: llmInput,
      model: llm.model,
      dealType: llm.dealType,
      documentType: llm.documentType,
      method: "llm",
      confidence: llm.confidence,
      signals: llm.signals,
      note: "heuristic inconclusive — used LLM",
    });
    return {
      dealType: llm.dealType,
      documentType: llm.documentType,
      method: "llm",
      confidence: llm.confidence,
    };
  }

  if (heuristic.documentType !== "OTHER") {
    trace?.recordClassification({
      text: headerText,
      dealType: heuristic.dealType,
      documentType: heuristic.documentType,
      method: "heuristic",
      confidence: "medium",
    });
    return {
      dealType: heuristic.dealType,
      documentType: heuristic.documentType,
      method: "heuristic",
      confidence: "medium",
    };
  }

  const resolved = resolveUnknownType(heuristic, filename);
  trace?.recordClassification({
    text: headerText,
    dealType: resolved.dealType,
    documentType: resolved.documentType,
    method: resolved.method,
    confidence: resolved.confidence ?? "low",
    note:
      resolved.confidence === "low"
        ? "unclassified — used filename/heuristic fallback"
        : undefined,
  });

  return resolved;
}
