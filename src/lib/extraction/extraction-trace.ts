import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";

/** Preview length shown by default in UI; full text stored when EXTRACTION_TRACE_FULL=true */
export const TRACE_PREVIEW_CHARS = 600;

export type LocationSource = "toc" | "regex" | "none";

export type ExtractionTraceStepKind =
  | "classification"
  | "toc_parse"
  | "tier1"
  | "loi"
  | "section"
  | "section_skip"
  | "section_retry";

export type ExtractionTraceStep = {
  kind: ExtractionTraceStepKind;
  label: string;
  model?: string;
  inputChars: number;
  inputPreview: string;
  inputFull?: string;
  pageNumbers?: number[];
  sectionId?: string;
  located?: boolean;
  locationSource?: LocationSource;
  tocLabel?: string;
  fieldsFilled?: number;
  fieldsTotal?: number;
  outputSummary?: string;
  error?: string;
  durationMs?: number;
};

export type ExtractionTrace = {
  version: 1;
  createdAt: string;
  steps: ExtractionTraceStep[];
};

function storeFullText(): boolean {
  return process.env.EXTRACTION_TRACE_FULL === "true";
}

function previewText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TRACE_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, TRACE_PREVIEW_CHARS)}…`;
}

function inputPayload(text: string): {
  inputChars: number;
  inputPreview: string;
  inputFull?: string;
} {
  const inputChars = text.length;
  return {
    inputChars,
    inputPreview: previewText(text),
    ...(storeFullText() ? { inputFull: text } : {}),
  };
}

export class ExtractionTraceCollector {
  private readonly steps: ExtractionTraceStep[] = [];
  private readonly startedAt = Date.now();

  record(step: Omit<ExtractionTraceStep, "inputChars" | "inputPreview"> & {
    text?: string;
    inputChars?: number;
    inputPreview?: string;
    inputFull?: string;
  }): void {
    const { text, ...rest } = step;
    const input =
      text !== undefined
        ? inputPayload(text)
        : {
            inputChars: rest.inputChars ?? 0,
            inputPreview: rest.inputPreview ?? "",
            ...(rest.inputFull ? { inputFull: rest.inputFull } : {}),
          };

    this.steps.push({
      ...rest,
      ...input,
      durationMs: rest.durationMs ?? Date.now() - this.startedAt,
    });
  }

  recordClassification(params: {
    text: string;
    model?: string;
    dealType: string;
    documentType: string;
    method: "llm" | "heuristic" | "filename";
    confidence?: string;
    signals?: string[];
    note?: string;
    error?: string;
  }): void {
    this.record({
      kind: "classification",
      label: `Classification (${params.method})`,
      text: params.text,
      model: params.model,
      outputSummary: `${params.documentType} / ${params.dealType}${
        params.confidence ? ` · ${params.confidence} confidence` : ""
      }${params.signals?.length ? ` · signals: ${params.signals.join(", ")}` : ""}${
        params.note ? ` · ${params.note}` : ""
      }`,
      error: params.error,
    });
  }

  recordTocParse(params: {
    text: string;
    entryCount: number;
    mappedSectionCount: number;
    found: boolean;
  }): void {
    this.record({
      kind: "toc_parse",
      label: "Table of contents",
      text: params.text,
      outputSummary: params.found
        ? `${params.entryCount} entries · ${params.mappedSectionCount} mapped to schema`
        : "No TOC detected",
    });
  }

  recordLlmExtraction(params: {
    kind: "tier1" | "loi" | "section" | "section_retry";
    label: string;
    text: string;
    model?: string;
    sectionId?: string;
    located?: boolean;
    locationSource?: LocationSource;
    tocLabel?: string;
    pageNumbers?: number[];
    fieldsFilled: number;
    fieldsTotal: number;
    error?: string;
  }): void {
    this.record({
      kind: params.kind,
      label: params.label,
      text: params.text,
      model: params.model,
      sectionId: params.sectionId,
      located: params.located,
      locationSource: params.locationSource,
      tocLabel: params.tocLabel,
      pageNumbers: params.pageNumbers,
      fieldsFilled: params.fieldsFilled,
      fieldsTotal: params.fieldsTotal,
      outputSummary: `${params.fieldsFilled}/${params.fieldsTotal} fields filled`,
      error: params.error,
    });
  }

  recordSectionSkip(params: {
    sectionId: string;
    reason: string;
  }): void {
    this.record({
      kind: "section_skip",
      label: `Section: ${params.sectionId}`,
      sectionId: params.sectionId,
      located: false,
      locationSource: "none",
      inputChars: 0,
      inputPreview: "",
      outputSummary: params.reason,
    });
  }

  toTrace(): ExtractionTrace {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      steps: this.steps,
    };
  }
}

export function traceToMetadataField(trace: ExtractionTrace): ParsedFieldValue {
  return {
    value: JSON.stringify(trace),
    confidence: 1,
    rawLabel: "_extraction_trace",
  };
}

export function parseExtractionTrace(
  metadata: Record<string, { value?: unknown }> | null | undefined
): ExtractionTrace | null {
  const raw = metadata?._extraction_trace?.value;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as ExtractionTrace;
    if (parsed?.version === 1 && Array.isArray(parsed.steps)) return parsed;
  } catch {
    return null;
  }
  return null;
}
