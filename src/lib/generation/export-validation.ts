import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";
import { computeDraftCompleteness } from "@/lib/generation/draft-completeness";

export type ExportValidationWarning = {
  code: "empty_field" | "missing_preamble" | "low_completeness";
  message: string;
  fieldKey?: string;
  fieldLabel?: string;
};

export type ExportValidationResult = {
  valid: boolean;
  warnings: ExportValidationWarning[];
  completenessPct: number;
};

/** Pre-export review: surface empty sections and low completeness before PDF/DOCX. */
export function validateDraftForExport(
  content: LoiDraftContent
): ExportValidationResult {
  const warnings: ExportValidationWarning[] = [];
  const { completenessPct } = computeDraftCompleteness(content);

  const hasPreamble = content.sections.some((section) =>
    section.fields.some(
      (field) => field.key === "preamble" && field.value?.trim()
    )
  );
  if (!hasPreamble && !content.documentTitle?.trim()) {
    warnings.push({
      code: "missing_preamble",
      message:
        "No preamble or document title — export will rely on template letterhead only.",
    });
  }

  for (const section of content.sections) {
    for (const field of section.fields) {
      if (field.key === "preamble") continue;
      if (!field.value?.trim()) {
        warnings.push({
          code: "empty_field",
          message: `Section "${field.label}" is empty and will be omitted from export.`,
          fieldKey: field.key,
          fieldLabel: field.label,
        });
      }
    }
  }

  if (completenessPct < 50) {
    warnings.push({
      code: "low_completeness",
      message: `Draft is only ${completenessPct}% complete — review before sending.`,
    });
  }

  return {
    valid: warnings.filter((w) => w.code === "empty_field").length === 0,
    warnings,
    completenessPct,
  };
}

/** Strip/replace characters illegal in HTTP header values (Latin-1 printable ASCII). */
export function sanitizeHttpHeaderValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 2048);
}

export function formatExportWarnings(
  warnings: ExportValidationWarning[]
): string {
  const joined = warnings.map((w) => w.message).join("; ");
  return sanitizeHttpHeaderValue(joined);
}
