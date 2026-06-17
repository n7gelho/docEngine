import type { DocumentMetadataJson } from "@/lib/db/schema";
import {
  DEAL_PARAMETER_KEYS,
  parseDealParameters,
  parseDealParametersCoverage,
} from "@/lib/extraction/deal-parameters";

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

export function formatDealParametersLine(
  metadata: DocumentMetadataJson | null | undefined
): string {
  const coverage = parseDealParametersCoverage(metadata);
  if (!coverage) return "deal parameters: —";
  return `deal parameters: ${coverage.filled}/${coverage.total}`;
}

export function listDealParameterValues(
  metadata: DocumentMetadataJson | null | undefined
): Array<{ key: string; value: string }> {
  const parameters = parseDealParameters(metadata);
  if (!parameters) return [];
  return DEAL_PARAMETER_KEYS.map((key) => ({
    key,
    value:
      parameters[key]?.value === null ||
      parameters[key]?.value === undefined
        ? "—"
        : String(parameters[key].value),
  }));
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
