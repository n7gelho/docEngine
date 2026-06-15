"use client";

import { useState } from "react";
import type { ExtractionTrace, ExtractionTraceStep } from "@/lib/extraction/extraction-trace";

type ExtractionTracePanelProps = {
  trace: ExtractionTrace | null;
};

const KIND_LABELS: Record<ExtractionTraceStep["kind"], string> = {
  classification: "Classification",
  toc_parse: "Table of contents",
  tier1: "OLA header",
  loi: "LOI extraction",
  section: "Section pass",
  section_skip: "Section skipped",
  section_retry: "Section retry",
};

function StepBadge({ step }: { step: ExtractionTraceStep }) {
  if (step.locationSource && step.locationSource !== "none") {
    return (
      <span className="badge bg-slate-100 text-slate-700">
        via {step.locationSource}
      </span>
    );
  }
  return null;
}

function TraceStepRow({
  step,
  index,
}: {
  step: ExtractionTraceStep;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const fullText = step.inputFull ?? step.inputPreview;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="mt-0.5 w-6 shrink-0 text-xs font-medium text-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{step.label}</span>
            <span className="badge bg-slate-100 text-slate-600">
              {KIND_LABELS[step.kind]}
            </span>
            <StepBadge step={step} />
            {step.model && (
              <span className="text-xs text-muted">{step.model}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {step.inputChars > 0
              ? `${step.inputChars.toLocaleString()} chars sent`
              : "No text sent"}
            {step.pageNumbers?.length
              ? ` · pages ${step.pageNumbers.join(", ")}`
              : ""}
            {step.outputSummary ? ` · ${step.outputSummary}` : ""}
            {step.error ? ` · error: ${step.error}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border bg-slate-50 px-4 py-3 pl-10">
          {step.tocLabel && (
            <p className="mb-2 text-xs text-muted">
              TOC label: <span className="text-slate-700">{step.tocLabel}</span>
            </p>
          )}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
            {fullText || "(empty)"}
          </pre>
          {step.inputFull && step.inputFull !== step.inputPreview && (
            <p className="mt-2 text-xs text-muted">
              Showing full prompt text (EXTRACTION_TRACE_FULL=true)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ExtractionTracePanel({ trace }: ExtractionTracePanelProps) {
  if (!trace || trace.steps.length === 0) {
    return (
      <div className="card">
        <h2 className="mb-2 text-lg font-semibold">Extraction trace</h2>
        <p className="text-sm text-muted">
          No trace recorded. Reprocess the document to capture what was sent to
          the model.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold">Extraction trace</h2>
        <p className="mt-1 text-sm text-muted">
          Step-by-step log of text sent to the model during processing. Expand
          each step to inspect the prompt input.
        </p>
      </div>
      <div>
        {trace.steps.map((step, index) => (
          <TraceStepRow key={`${step.kind}-${step.label}-${index}`} step={step} index={index} />
        ))}
      </div>
    </div>
  );
}
