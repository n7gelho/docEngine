import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";
import type { Document } from "@/lib/db/schema";
import {
  DEAL_PARAMETER_LABELS,
  getFilledBriefKeys,
  normalizeBriefValue,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import {
  blockOverlapsBlock,
  blockOverlapsPreamble,
  compactText,
  extractMashedScheduleRows,
  isGenericSectionLabel,
  isLoiSubheadingLine,
  isPageMarkerLine,
  isScheduleHeaderFragment,
  isValidLoiSectionTitle,
  normalizeExportText,
  tryParseMashedBoeingScheduleRow,
  tryParseScheduleRow,
} from "@/lib/generation/export-loi-normalize";
import { inferLoiSectionTitle } from "@/lib/generation/loi-section-extract";

export type TemplateDocContext = Pick<
  Document,
  | "fullText"
  | "dealType"
  | "metadata"
  | "lessor"
  | "lessee"
  | "seller"
  | "buyer"
  | "aircraftType"
  | "term"
  | "leaseType"
  | "monthlyRent"
  | "currency"
  | "securityDeposit"
  | "expectedDelivery"
  | "aircraftCount"
  | "governingLaw"
>;

export type ExportFieldBlock = {
  key: string;
  label: string;
  text: string;
};

export type ExportContentSegment =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

export type ExportDocumentInput = {
  content: LoiDraftContent;
  brief?: ProformaBrief | null;
  templateDoc?: TemplateDocContext | null;
  /** Preamble from template donor when draft omits letterhead. */
  templatePreamble?: string | null;
  templateFilename?: string | null;
  /** Original uploaded PDF from template donor (letterhead shell). */
  templatePdfBuffer?: Buffer | null;
  templateMimeType?: string | null;
  /** Signature / closing block from template donor. */
  templateClosingBlock?: string | null;
  /** Full text of template donor for divergence checks. */
  templateFullText?: string | null;
};

export function collectExportFieldBlocks(
  content: LoiDraftContent
): ExportFieldBlock[] {
  const blocks: ExportFieldBlock[] = [];

  for (const section of content.sections) {
    for (const field of section.fields) {
      const text = field.value?.trim();
      if (!text) continue;
      blocks.push({
        key: field.key,
        label: field.label,
        text: normalizeExportText(text),
      });
    }
  }

  return blocks;
}

function normalizeLine(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when field text already opens with its section heading. */
export function fieldTextIncludesHeading(field: {
  label: string;
  text?: string | null;
  value?: string | null;
}): boolean {
  const text = normalizeExportText((field.text ?? field.value) ?? "");
  if (!text) return false;
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const label = field.label.trim();
  if (!firstLine || !label) return false;

  if (isGenericSectionLabel(label)) {
    return isValidLoiSectionTitle(firstLine) && !/^section\s+\d+$/i.test(firstLine);
  }

  const a = normalizeLine(firstLine);
  const b = normalizeLine(label);
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return false;
}

export function splitTextIntoParagraphs(text: string): string[] {
  const normalized = normalizeExportText(text);
  return normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function splitTextIntoLines(text: string): string[] {
  return normalizeExportText(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isPageMarkerLine(l));
}

export function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (tryParseScheduleRow(trimmed)) return true;
  if (/\t/.test(trimmed)) return true;
  if ((trimmed.match(/\|/g)?.length ?? 0) >= 2) return true;
  const spacedCols = trimmed.split(/\s{2,}/).filter(Boolean);
  return spacedCols.length >= 3 && trimmed.length < 200;
}

export function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const schedule = tryParseScheduleRow(trimmed);
  if (schedule) return schedule;
  if (/\t/.test(trimmed)) {
    return trimmed.split(/\t+/).map((c) => c.trim()).filter(Boolean);
  }
  if ((trimmed.match(/\|/g)?.length ?? 0) >= 2) {
    return trimmed
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return trimmed.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
}

function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return /^[\|\s\-–—:+]+$/.test(trimmed) && /-{2,}/.test(trimmed);
}

/** Split block text into paragraphs, subheadings, and tables (no inline main headings). */
export function parseBlockBodyIntoSegments(text: string): ExportContentSegment[] {
  const lines = normalizeExportText(text).split("\n");
  const segments: ExportContentSegment[] = [];
  let tableRows: string[][] = [];
  let paragraphLines: string[] = [];
  let pendingScheduleRows: string[][] = [];

  function flushScheduleTable() {
    if (pendingScheduleRows.length === 0) return;
    segments.push({
      kind: "table",
      rows: [
        ["Airframe", "Engines", "MSN", "Delivery Quarter", "Scheduled Delivery"],
        ...pendingScheduleRows,
      ],
    });
    pendingScheduleRows = [];
  }

  function flushParagraph() {
    const joined = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!joined) return;

    const mashedSchedule = extractMashedScheduleRows(joined);
    if (mashedSchedule && mashedSchedule.length > 1) {
      const prefix = joined.split(/Boeing\s+\d{3}-\d+/i)[0]?.trim();
      if (
        prefix &&
        prefix.length > 20 &&
        !/^airframe\b/i.test(prefix) &&
        !isScheduleHeaderOnlyText(prefix)
      ) {
        segments.push({
          kind: "paragraph",
          text: prefix.replace(/\s+/g, " ").trim(),
        });
      }
      flushScheduleTable();
      segments.push({ kind: "table", rows: mashedSchedule });
      return;
    }

    for (const chunk of splitTextIntoParagraphs(joined)) {
      const inlineSchedule = extractMashedScheduleRows(chunk);
      if (inlineSchedule && inlineSchedule.length > 1) {
        const prefix = chunk.split(/Boeing\s+\d{3}-\d+/i)[0]?.trim();
        if (prefix && prefix.length > 10 && !isScheduleHeaderOnlyText(prefix)) {
          segments.push({ kind: "paragraph", text: prefix.replace(/\s+/g, " ").trim() });
        }
        flushScheduleTable();
        segments.push({ kind: "table", rows: inlineSchedule });
      } else {
        segments.push({ kind: "paragraph", text: chunk });
      }
    }
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    flushScheduleTable();
    segments.push({ kind: "table", rows: tableRows });
    tableRows = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || isPageMarkerLine(line)) {
      flushTable();
      flushParagraph();
      flushScheduleTable();
      continue;
    }

    if (isTableSeparatorRow(line)) continue;

    if (isScheduleHeaderFragment(line)) {
      continue;
    }

    const scheduleRow = tryParseMashedBoeingScheduleRow(line);
    if (scheduleRow) {
      flushParagraph();
      flushTable();
      pendingScheduleRows.push(scheduleRow);
      continue;
    }

    if (isTableRow(line)) {
      flushParagraph();
      flushScheduleTable();
      tableRows.push(parseTableRow(line));
      continue;
    }

    if (isLoiSubheadingLine(line)) {
      flushTable();
      flushParagraph();
      flushScheduleTable();
      segments.push({ kind: "subheading", text: line.trim() });
      continue;
    }

    flushTable();
    paragraphLines.push(line);
  }

  flushTable();
  flushParagraph();
  flushScheduleTable();
  return segments;
}

function isScheduleHeaderOnlyText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  return (
    /^airframe\s+engines?\s+msn/i.test(normalized) &&
    !/\b(?:shall|the|lessee|lessor|aircraft)\b/i.test(normalized)
  );
}

/** @deprecated Prefer parseBlockBodyIntoSegments for section bodies. */
export function parseBlockIntoSegments(text: string): ExportContentSegment[] {
  const lines = normalizeExportText(text).split("\n");
  const segments: ExportContentSegment[] = [];
  let tableRows: string[][] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const joined = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!joined) return;

    for (const chunk of splitTextIntoParagraphs(joined)) {
      segments.push({ kind: "paragraph", text: chunk });
    }
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    segments.push({ kind: "table", rows: tableRows });
    tableRows = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || isPageMarkerLine(line)) {
      flushTable();
      flushParagraph();
      continue;
    }

    if (isTableSeparatorRow(line)) continue;

    if (isHeadingLine(line) && tableRows.length === 0 && paragraphLines.length === 0) {
      flushTable();
      flushParagraph();
      segments.push({ kind: "heading", text: line.trim() });
      continue;
    }

    if (isTableRow(line)) {
      flushParagraph();
      tableRows.push(parseTableRow(line));
      continue;
    }

    flushTable();
    paragraphLines.push(line);
  }

  flushTable();
  flushParagraph();
  return segments;
}

export function resolvePreambleForExport(input: ExportDocumentInput): string | null {
  const blocks = collectExportFieldBlocks(input.content);
  const draftPreamble = blocks.find((b) => b.key === "preamble");
  if (draftPreamble?.text) return draftPreamble.text;

  const templatePre = input.templatePreamble?.trim();
  if (!templatePre) return null;

  const firstBody = blocks.find(
    (b) =>
      b.key !== "preamble" &&
      b.key !== "closing" &&
      b.key !== "signature"
  )?.text;
  const normalizedTemplate = normalizeExportText(templatePre);
  if (firstBody && blockOverlapsPreamble(firstBody, normalizedTemplate)) {
    return null;
  }
  return normalizedTemplate;
}

/** Draft already contains a full ported LOI — skip template page overlay. */
export function draftHasFullContent(input: ExportDocumentInput): boolean {
  const blocks = collectExportFieldBlocks(input.content);
  const bodyBlocks = blocks.filter((b) => b.key !== "preamble");
  const hasPreamble = blocks.some((b) => b.key === "preamble" && b.text);
  if (hasPreamble && bodyBlocks.length >= 1) return true;
  const totalChars = bodyBlocks.reduce((sum, b) => sum + b.text.length, 0);
  return bodyBlocks.length >= 3 || totalChars > 4000;
}

export function resolveBodyBlocksForExport(
  input: ExportDocumentInput
): ExportFieldBlock[] {
  const blocks = collectExportFieldBlocks(input.content);
  const preamble = resolvePreambleForExport(input);
  const closing = resolveClosingBlockForExport(input);
  const body = blocks.filter(
    (b) =>
      b.key !== "preamble" &&
      b.key !== "closing" &&
      b.key !== "signature"
  );

  const filtered: ExportFieldBlock[] = [];
  let cumulative = preamble ?? "";

  for (const block of body) {
    if (preamble && blockOverlapsPreamble(block.text, preamble)) {
      continue;
    }
    if (cumulative && blockOverlapsBlock(block.text, cumulative)) {
      continue;
    }
    if (closing && blockOverlapsPreamble(block.text, closing)) {
      continue;
    }
    filtered.push(block);
    cumulative = cumulative
      ? `${cumulative}\n\n${block.text}`
      : block.text;
  }

  return filtered;
}

export function resolveClosingBlockForExport(
  input: ExportDocumentInput
): string | null {
  const blocks = collectExportFieldBlocks(input.content);
  const draftClosing = blocks.find(
    (b) => b.key === "closing" || b.key === "signature"
  );
  let closing: string | null = draftClosing?.text ?? null;
  if (!closing && input.templateClosingBlock?.trim()) {
    closing = normalizeExportText(input.templateClosingBlock);
  }
  if (!closing) return null;

  const bodyText = blocks
    .filter(
      (b) =>
        b.key !== "preamble" &&
        b.key !== "closing" &&
        b.key !== "signature"
    )
    .map((b) => b.text)
    .join("\n\n");
  if (bodyText && blockOverlapsPreamble(closing, bodyText)) {
    return null;
  }
  return closing;
}

export function safeExportBasename(content: LoiDraftContent): string {
  const raw =
    content.documentTitle?.trim() ||
    content.templateFilename?.replace(/\.[^.]+$/, "") ||
    "loi-draft";
  return raw
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

/** @deprecated Use isValidLoiSectionTitle from export-loi-normalize. */
export function isHeadingLine(line: string): boolean {
  return isValidLoiSectionTitle(line);
}

function stripLeadingDuplicateTitle(text: string, title: string): string {
  const lines = splitTextIntoLines(text);
  if (lines.length === 0) return text;
  if (normalizeLine(lines[0]) === normalizeLine(title)) {
    return lines.slice(1).join("\n");
  }
  return text;
}

function resolveSectionHeading(
  label: string,
  lines: string[]
): { heading: string | null; bodyText: string } {
  const text = lines.join("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const labelValid =
    isValidLoiSectionTitle(label) && !shouldSkipInjectedLabel(label);
  const firstValid = isValidLoiSectionTitle(firstLine);

  if (firstValid && fieldTextIncludesHeading({ label, text: text })) {
    return { heading: firstLine, bodyText: lines.slice(1).join("\n") };
  }

  if (firstValid && !labelValid) {
    return { heading: firstLine, bodyText: lines.slice(1).join("\n") };
  }

  if (labelValid) {
    return {
      heading: label,
      bodyText: stripLeadingDuplicateTitle(text, label),
    };
  }

  if (firstValid) {
    return { heading: firstLine, bodyText: lines.slice(1).join("\n") };
  }

  const inferred = inferLoiSectionTitle(text, 0);
  if (
    isValidLoiSectionTitle(inferred) &&
    !isGenericSectionLabel(inferred) &&
    inferred !== "Transaction parties"
  ) {
    return { heading: inferred, bodyText: text };
  }

  if (isTransactionPartiesHeadingCandidate(lines)) {
    return { heading: "Transaction parties", bodyText: text };
  }

  return { heading: null, bodyText: text };
}

function isTransactionPartiesHeadingCandidate(lines: string[]): boolean {
  const opening = lines.slice(0, 8).join("\n");
  const hasLessor = lines.some((line) =>
    /^lessor\s*(?:[.:]\s*)?$/i.test(line.trim())
  );
  const hasLessee = lines.some((line) =>
    /^lessee\s*(?:[.:]\s*)?$/i.test(line.trim())
  );
  return hasLessor && hasLessee && opening.length < 800;
}

function shouldSkipInjectedLabel(label: string): boolean {
  const trimmed = label.trim();
  return isGenericSectionLabel(trimmed) || /^preamble$/i.test(trimmed);
}

/** Preamble is flowing letter text — no bold heading detection. */
export function parsePreambleIntoSegments(text: string): ExportContentSegment[] {
  const paragraphs = normalizeExportText(text)
    .split("\n")
    .filter((line) => !/^letter of intent$/i.test(line.trim()))
    .join("\n")
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return paragraphs.map((paragraph) => ({ kind: "paragraph", text: paragraph }));
}

export function blockToSegments(
  block: { key?: string; label: string; text: string }
): ExportContentSegment[] {
  const text = normalizeExportText(block.text);
  const label = block.label.trim();
  const lines = splitTextIntoLines(text);
  const { heading, bodyText } = resolveSectionHeading(label, lines);

  const segments: ExportContentSegment[] = [];
  if (heading) {
    segments.push({ kind: "heading", text: heading });
  }
  segments.push(...parseBlockBodyIntoSegments(bodyText));
  return segments;
}

export function allBodySegments(
  input: ExportDocumentInput
): ExportContentSegment[] {
  const segments: ExportContentSegment[] = [];
  for (const block of resolveBodyBlocksForExport(input)) {
    segments.push(...blockToSegments(block));
  }
  return segments;
}

export function preambleSegments(
  input: ExportDocumentInput
): ExportContentSegment[] {
  const preamble = resolvePreambleForExport(input);
  if (!preamble) return [];
  return parsePreambleIntoSegments(preamble);
}

export function closingSegments(
  input: ExportDocumentInput
): ExportContentSegment[] {
  const closing = resolveClosingBlockForExport(input);
  if (!closing) return [];
  return parseBlockBodyIntoSegments(closing);
}

function dedupeSegments(
  segments: ExportContentSegment[]
): ExportContentSegment[] {
  const deduped: ExportContentSegment[] = [];
  let cumulative = "";

  for (const segment of segments) {
    const prev = deduped[deduped.length - 1];
    if (
      segment.kind === "heading" &&
      prev?.kind === "heading" &&
      normalizeLine(segment.text) === normalizeLine(prev.text)
    ) {
      continue;
    }

    const fingerprint =
      segment.kind === "table"
        ? compactText(segment.rows.map((row) => row.join(" ")).join("\n"))
        : segment.kind === "subheading" || segment.kind === "heading"
          ? compactText(segment.text)
          : compactText(segment.text);

    if (fingerprint.length >= 50 && blockOverlapsBlock(fingerprint, cumulative)) {
      continue;
    }

    if (
      (segment.kind === "heading" || segment.kind === "subheading") &&
      prev &&
      (prev.kind === "heading" || prev.kind === "subheading") &&
      normalizeLine(segment.text) === normalizeLine(prev.text)
    ) {
      continue;
    }

    deduped.push(segment);
    cumulative = cumulative
      ? `${cumulative}\n${fingerprint}`
      : fingerprint;
  }

  return deduped;
}

export function buildMergedExportSegments(
  input: ExportDocumentInput
): ExportContentSegment[] {
  const preamble = resolvePreambleForExport(input);
  const bodyBlocks = resolveBodyBlocksForExport(input);
  const omitPreamble =
    !!preamble &&
    bodyBlocks.some((block) => blockOverlapsPreamble(block.text, preamble));

  const segments: ExportContentSegment[] = [];
  if (preamble && !omitPreamble) {
    segments.push(...preambleSegments(input));
  }
  for (const block of bodyBlocks) {
    segments.push(...blockToSegments(block));
  }
  segments.push(...closingSegments(input));
  return dedupeSegments(segments);
}

export function buildMergedPlainText(input: ExportDocumentInput): string {
  return buildMergedExportSegments(input)
    .map((segment) => {
      if (segment.kind === "table") {
        return segment.rows.map((row) => row.join("  ")).join("\n");
      }
      if (segment.kind === "heading" || segment.kind === "subheading") {
        return segment.text;
      }
      return segment.text;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Fall back to regenerated PDF when draft content diverges heavily from template. */
export function draftStructurallyDivergedFromTemplate(
  input: ExportDocumentInput
): boolean {
  const templateText = input.templateFullText?.trim();
  if (!templateText) return false;

  const draftText = buildMergedPlainText(input);
  const draft = compactText(draftText);
  const template = compactText(templateText);
  if (!draft || !template) return false;

  const ratio = draft.length / template.length;
  if (ratio < 0.65 || ratio > 1.55) return true;

  const window = Math.min(1200, draft.length, template.length);
  if (window < 200) return false;

  let hits = 0;
  const steps = Math.floor(window / 30);
  for (let i = 0; i < steps; i++) {
    const slice = draft.slice(i * 30, i * 30 + 50);
    if (slice.length >= 20 && template.includes(slice)) hits++;
  }
  return hits / Math.max(steps, 1) < 0.3;
}

/** True when the user has manually edited at least one section in the draft editor. */
export function draftHasUserEdits(content: LoiDraftContent): boolean {
  for (const section of content.sections) {
    for (const field of section.fields) {
      if (field.source === "user" && field.value?.trim()) {
        return true;
      }
    }
  }
  return false;
}

export function canUseTemplatePreserveExport(
  input: ExportDocumentInput
): input is ExportDocumentInput & { templatePdfBuffer: Buffer } {
  if (draftHasUserEdits(input.content)) return false;
  if (draftStructurallyDivergedFromTemplate(input)) return false;
  return (
    !!input.content.templateDocumentId &&
    !!input.templatePdfBuffer &&
    input.templatePdfBuffer.length > 0 &&
    (input.templateMimeType === "application/pdf" ||
      input.templateFilename?.toLowerCase().endsWith(".pdf") === true)
  );
}

export function canUseEditedDraftPdfExport(
  input: ExportDocumentInput
): input is ExportDocumentInput & { templatePdfBuffer: Buffer } {
  if (!draftHasUserEdits(input.content)) return false;
  return (
    !!input.content.templateDocumentId &&
    !!input.templatePdfBuffer &&
    input.templatePdfBuffer.length > 0 &&
    (input.templateMimeType === "application/pdf" ||
      input.templateFilename?.toLowerCase().endsWith(".pdf") === true)
  );
}

export function canUseTemplateSubstituteExport(
  input: ExportDocumentInput
): input is ExportDocumentInput & {
  templatePdfBuffer: Buffer;
  templateDoc: TemplateDocContext;
  brief: ProformaBrief;
} {
  if (draftHasUserEdits(input.content)) return false;
  if (draftStructurallyDivergedFromTemplate(input)) return false;
  if (!input.brief || getFilledBriefKeys(input.brief).length === 0) return false;
  if (!input.templateDoc?.fullText?.trim()) return false;
  return (
    !!input.content.templateDocumentId &&
    !!input.templatePdfBuffer &&
    input.templatePdfBuffer.length > 0 &&
    (input.templateMimeType === "application/pdf" ||
      input.templateFilename?.toLowerCase().endsWith(".pdf") === true)
  );
}

export type DealSummaryRow = { label: string; value: string };

function summaryValue(
  briefValue: string | number | null | undefined,
  templateValue: string | number | null | undefined
): string | null {
  return (
    normalizeBriefValue(briefValue) ?? normalizeBriefValue(templateValue)
  );
}

/** Key deal terms for the house-template summary box (brief overrides template). */
export function buildDealSummaryRows(
  input: ExportDocumentInput
): DealSummaryRow[] {
  const brief = input.brief;
  const doc = input.templateDoc;
  const rows: DealSummaryRow[] = [];

  const push = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };

  const dealType = doc?.dealType?.toLowerCase() ?? "";
  const isPurchase = dealType.includes("purchase") || dealType.includes("sale");

  if (isPurchase) {
    push("Seller", summaryValue(undefined, doc?.seller));
    push("Buyer", summaryValue(brief?.counterparty, doc?.buyer));
  } else {
    push("Lessor", summaryValue(undefined, doc?.lessor));
    push("Lessee", summaryValue(brief?.counterparty, doc?.lessee));
  }

  push("Aircraft", summaryValue(brief?.aircraft, doc?.aircraftType));
  push(
    DEAL_PARAMETER_LABELS.aircraft_count,
    summaryValue(brief?.aircraft_count, doc?.aircraftCount)
  );
  push(
    DEAL_PARAMETER_LABELS.transaction_type,
    summaryValue(brief?.transaction_type, doc?.leaseType)
  );
  push(DEAL_PARAMETER_LABELS.lease_term, summaryValue(brief?.lease_term, doc?.term));
  push(
    DEAL_PARAMETER_LABELS.monthly_rent,
    summaryValue(
      brief?.monthly_rent,
      doc?.monthlyRent && doc?.currency
        ? `${doc.currency} ${doc.monthlyRent}`
        : doc?.monthlyRent
    )
  );
  push(
    DEAL_PARAMETER_LABELS.security_deposit,
    summaryValue(brief?.security_deposit, doc?.securityDeposit)
  );
  push(
    DEAL_PARAMETER_LABELS.expected_delivery,
    summaryValue(brief?.expected_delivery, doc?.expectedDelivery)
  );
  push(
    "Governing law",
    summaryValue(brief?.governingLaw, doc?.governingLaw)
  );

  return rows;
}

/** Default PDF export uses the owned house layout (no precedent PDF overlay). */
export function canUseHousePdfExport(input: ExportDocumentInput): boolean {
  return collectExportFieldBlocks(input.content).length > 0;
}

/** Footer label: "{Lessor name} LOI" when lessor is known. */
export function resolveExportFooterLabel(input: ExportDocumentInput): string {
  const summaryLessor = buildDealSummaryRows(input).find(
    (row) => row.label === "Lessor" || row.label === "Seller"
  )?.value;

  const fieldLessor = collectExportFieldBlocks(input.content).find(
    (block) => block.key === "lessor"
  )?.text;

  const raw =
    input.templateDoc?.lessor?.trim() ||
    summaryLessor ||
    fieldLessor ||
    null;

  if (!raw) return "LOI";

  const primary = raw
    .split("\n")[0]
    ?.replace(/\s*,\s*and\/or\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!primary) return "LOI";
  return `${primary} LOI`;
}
