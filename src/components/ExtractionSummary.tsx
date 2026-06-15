"use client";

import {
  formatCoverageSummary,
  parseExtractionCoverage,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import type { MetadataField } from "@/lib/types";

import type { ExtractionTrace } from "@/lib/extraction/extraction-trace";

type ExtractionSummaryProps = {
  documentType?: string | null;
  extractionModel?: string | null;
  metadata?: Record<string, MetadataField> | null;
  extractionTrace?: ExtractionTrace | null;
};

/** Prefer stored extraction_model; fall back to trace step model. */
export function resolveDisplayedExtractionModel(
  extractionModel?: string | null,
  trace?: ExtractionTrace | null
): string | null {
  if (extractionModel?.trim()) return extractionModel.trim();
  if (!trace) return null;

  const step = trace.steps.find(
    (s) =>
      (s.kind === "loi" || s.kind === "tier1") && s.model?.trim()
  );
  if (step?.model) return step.model;

  const section = trace.steps.find(
    (s) => s.kind === "section" && s.model?.trim()
  );
  return section?.model?.trim() ?? null;
}

function coverageBarColor(coverage: ExtractionCoverage): string {
  const pct =
    coverage.fieldsTotal > 0
      ? coverage.fieldsFilled / coverage.fieldsTotal
      : 0;
  if (pct >= 0.75) return "bg-emerald-500";
  if (pct >= 0.5) return "bg-amber-500";
  return "bg-red-400";
}

export function ExtractionSummary({
  documentType,
  extractionModel,
  metadata,
  extractionTrace,
}: ExtractionSummaryProps) {
  const coverage = parseExtractionCoverage(metadata ?? null);
  const model = resolveDisplayedExtractionModel(extractionModel, extractionTrace);
  if (!coverage && !model) return null;

  const pct =
    coverage && coverage.fieldsTotal > 0
      ? Math.round((coverage.fieldsFilled / coverage.fieldsTotal) * 100)
      : 0;

  const profileLabel =
    documentType === "OLA"
      ? "OLA profile"
      : documentType === "LOI"
        ? "LOI profile"
        : "Profile";

  return (
    <div className="card border-slate-200 bg-slate-50/80">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Extraction summary</h2>
            {model && (
              <span className="badge bg-indigo-100 font-mono text-xs text-indigo-900">
                {model}
              </span>
            )}
          </div>
          {coverage && (
            <p className="mt-1 text-sm text-muted">
              {formatCoverageSummary(coverage)}
            </p>
          )}
        </div>
      </div>

      {coverage && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums text-slate-900">
              {coverage.fieldsFilled}
              <span className="text-lg font-normal text-muted">
                {" "}
                / {coverage.fieldsTotal}
              </span>
            </span>
            <span className="text-sm font-medium text-muted">
              {profileLabel} fields · {pct}%
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={coverage.fieldsFilled}
            aria-valuemin={0}
            aria-valuemax={coverage.fieldsTotal}
            aria-label={`${coverage.fieldsFilled} of ${coverage.fieldsTotal} fields extracted`}
          >
            <div
              className={`h-full rounded-full transition-all ${coverageBarColor(coverage)}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {coverage.documentType === "OLA" &&
            coverage.sectionsTotal !== undefined && (
              <p className="mt-2 text-xs text-muted">
                Sections located: {coverage.sectionsLocated ?? 0} /{" "}
                {coverage.sectionsTotal}
              </p>
            )}
          {(coverage.warnings?.length ?? 0) > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-amber-800">
                {coverage.warnings!.length} extraction warning
                {coverage.warnings!.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                {coverage.warnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
