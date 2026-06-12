import type { DocumentMetadataJson } from "@/lib/db/schema";

export type ParsedCoverage = {
  tier1Filled?: number;
  tier1Total?: number;
  fieldsFilled?: number;
  fieldsTotal?: number;
  sectionsLocated?: number;
  sectionsTotal?: number;
  warnings?: string[];
};

export function parseCoverage(
  metadata: DocumentMetadataJson | null | undefined
): ParsedCoverage | null {
  const raw = metadata?._extraction_coverage?.value;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as ParsedCoverage;
  } catch {
    return null;
  }
}

export function formatCoverageLine(coverage: ParsedCoverage): string {
  let line = `tier1 ${coverage.tier1Filled ?? "?"}/${coverage.tier1Total ?? "?"}, fields ${coverage.fieldsFilled ?? "?"}/${coverage.fieldsTotal ?? "?"}`;
  if (coverage.sectionsLocated !== undefined) {
    line += `, sections ${coverage.sectionsLocated}/${coverage.sectionsTotal ?? "?"}`;
  }
  return line;
}

export function listFilledMetadataKeys(
  metadata: DocumentMetadataJson | null | undefined
): Array<{ key: string; value: string }> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([key, fv]) => {
      if (key.startsWith("_")) return false;
      const v = (fv as { value?: unknown }).value;
      return v !== null && v !== undefined && String(v).trim() !== "";
    })
    .map(([key, fv]) => ({
      key,
      value: String((fv as { value: unknown }).value),
    }));
}
