import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";

const SOFT_COPY_CONFIDENCE = 0.45;

function isFilled(field: ParsedFieldValue | undefined): boolean {
  return (
    field?.value !== null &&
    field?.value !== undefined &&
    String(field.value).trim() !== ""
  );
}

/**
 * When only one of governing_law / jurisdiction is stated in an LOI, copy to the
 * other at reduced confidence (distinct fields, soft inference).
 */
export function softCopyLoiGoverningLawJurisdiction(
  fields: Record<string, ParsedFieldValue>
): void {
  const governingLaw = fields.governing_law;
  const jurisdiction = fields.jurisdiction;
  const govFilled = isFilled(governingLaw);
  const jurFilled = isFilled(jurisdiction);

  if (govFilled && !jurFilled) {
    fields.jurisdiction = {
      value: governingLaw!.value,
      confidence: Math.min(
        governingLaw!.confidence ?? 0.75,
        SOFT_COPY_CONFIDENCE
      ),
      ...(governingLaw!.indicative ? { indicative: true } : {}),
    };
  } else if (jurFilled && !govFilled) {
    fields.governing_law = {
      value: jurisdiction!.value,
      confidence: Math.min(
        jurisdiction!.confidence ?? 0.75,
        SOFT_COPY_CONFIDENCE
      ),
      ...(jurisdiction!.indicative ? { indicative: true } : {}),
    };
  }
}
