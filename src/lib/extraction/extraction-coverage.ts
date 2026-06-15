import type { DealType, DocumentType } from "@/lib/db/schema";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import {
  getLoiProfile,
  getOlaProfile,
} from "@/lib/profiles/schema-registry";

export type ExtractionCoverage = {
  documentType: DocumentType;
  tier1Filled: number;
  tier1Total: number;
  fieldsFilled: number;
  fieldsTotal: number;
  sectionsLocated?: number;
  sectionsTotal?: number;
  warnings: string[];
};

function isFilled(fv: ParsedFieldValue | undefined): boolean {
  if (!fv) return false;
  const v = fv.value;
  return v !== null && v !== undefined && String(v).trim() !== "";
}

export function computeLoiCoverage(
  fields: Record<string, ParsedFieldValue>,
  dealType: DealType = "LEASE",
  warnings: string[] = []
): ExtractionCoverage {
  const profile = getLoiProfile(dealType);
  const filled = profile.fields.filter((f) => isFilled(fields[f.key])).length;

  return {
    documentType: "LOI",
    tier1Filled: filled,
    tier1Total: profile.fields.length,
    fieldsFilled: filled,
    fieldsTotal: profile.fields.length,
    warnings,
  };
}

export function computeOlaCoverage(
  sections: Record<string, Record<string, ParsedFieldValue>>,
  sectionsLocated: number,
  warnings: string[] = []
): ExtractionCoverage {
  const profile = getOlaProfile("LEASE");
  let fieldsFilled = 0;
  let fieldsTotal = 0;
  let tier1Filled = 0;
  const tier1Total = 7;

  const tier1Sections = new Set([
    "parties_and_recitals",
    "governing_law_and_jurisdiction",
  ]);
  const tier1FieldKeys = new Set([
    "aircraft",
    "msn",
    "governing_law",
    "jurisdiction",
    "lessor_entity",
    "lessee_entity",
    "seller_entity",
    "buyer_entity",
  ]);

  for (const section of profile.sections) {
    fieldsTotal += section.fields.length;
    const sectionData = sections[section.id] ?? {};
    for (const field of section.fields) {
      if (isFilled(sectionData[field.key])) {
        fieldsFilled++;
        if (
          tier1Sections.has(section.id) &&
          tier1FieldKeys.has(field.key)
        ) {
          tier1Filled++;
        }
      }
    }
  }

  tier1Filled = Math.min(tier1Filled, tier1Total);

  return {
    documentType: "OLA",
    tier1Filled,
    tier1Total,
    fieldsFilled,
    fieldsTotal,
    sectionsLocated,
    sectionsTotal: profile.sections.length,
    warnings,
  };
}

export function coverageToMetadataField(
  coverage: ExtractionCoverage
): ParsedFieldValue {
  return {
    value: JSON.stringify(coverage),
    confidence: 1,
    rawLabel: "_extraction_coverage",
  };
}
