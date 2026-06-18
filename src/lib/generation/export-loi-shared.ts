import type { LoiDraftContent, LoiDraftField } from "@/lib/generation/loi-draft-types";

export type ExportFieldBlock = {
  key: string;
  label: string;
  text: string;
};

export type ExportDocumentInput = {
  content: LoiDraftContent;
  /** Preamble from template donor when draft omits letterhead. */
  templatePreamble?: string | null;
  templateFilename?: string | null;
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
        text,
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
  const text = (field.text ?? field.value)?.trim();
  if (!text) return false;
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const label = field.label.trim();
  if (!firstLine || !label) return false;

  const a = normalizeLine(firstLine);
  const b = normalizeLine(label);
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (/^section\s+\d+$/i.test(label)) return false;
  return false;
}

export function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

export function splitTextIntoLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function resolvePreambleForExport(input: ExportDocumentInput): string | null {
  const blocks = collectExportFieldBlocks(input.content);
  const draftPreamble = blocks.find((b) => b.key === "preamble");
  if (draftPreamble?.text) return draftPreamble.text;

  if (input.templatePreamble?.trim()) return input.templatePreamble.trim();
  return null;
}

export function resolveBodyBlocksForExport(
  input: ExportDocumentInput
): ExportFieldBlock[] {
  const blocks = collectExportFieldBlocks(input.content);
  return blocks.filter((b) => b.key !== "preamble");
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
