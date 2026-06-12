import type { ParsedDocument } from "@/lib/parsing/parse-document";
import type { DealType, DocumentType } from "@/lib/db/schema";

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

function classifyFromFilename(filename: string): {
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

/** Resolve LOI/OLA for the ingestion pipeline (defaults unknown to LOI). */
export function classifyDocumentForIngestion(
  parsed: ParsedDocument,
  filename: string
): { dealType: DealType; documentType: DocumentType } {
  const classified = classifyDocumentHeuristic(
    buildClassificationText(parsed),
    filename
  );
  return {
    dealType: classified.dealType,
    documentType:
      classified.documentType === "OTHER" ? "LOI" : classified.documentType,
  };
}
