import type { DealType } from "@/lib/db/schema";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import { getOlaProfile } from "@/lib/profiles/schema-registry";

function isFilled(fv: ParsedFieldValue | undefined): boolean {
  if (!fv) return false;
  const v = fv.value;
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Skip a section LLM pass when every profile field for that section is already filled. */
export function isOlaSectionComplete(
  sectionId: string,
  dealType: DealType,
  sections: Record<string, Record<string, ParsedFieldValue>>
): boolean {
  const profile = getOlaProfile(dealType);
  const sectionDef = profile.sections.find((s) => s.id === sectionId);
  if (!sectionDef) return false;

  const data = sections[sectionId] ?? {};
  return sectionDef.fields.every((f) => isFilled(data[f.key]));
}
