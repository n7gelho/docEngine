import type { ParsedDocument } from "@/lib/parsing/parse-document";

export type TextChunk = {
  chunkIndex: number;
  text: string;
  heading?: string;
  pageStart?: number;
};

const MAX_CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 200;

const SECTION_PATTERN =
  /^(?:\d+(?:\.\d+)*\.?\s+|[A-Z][A-Z\s]{2,40}$|Schedule\s+\d+|Exhibit\s+[A-Z\d]+)/m;

export function chunkDocument(parsed: ParsedDocument): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  for (const page of parsed.pages) {
    const sections = splitIntoSections(page.text);

    for (const section of sections) {
      const subChunks = splitLongText(section.text, MAX_CHUNK_CHARS, OVERLAP_CHARS);
      for (const sub of subChunks) {
        chunks.push({
          chunkIndex: chunkIndex++,
          text: sub,
          heading: section.heading,
          pageStart: page.pageNumber,
        });
      }
    }
  }

  if (chunks.length === 0 && parsed.fullText) {
    const subChunks = splitLongText(parsed.fullText, MAX_CHUNK_CHARS, OVERLAP_CHARS);
    for (const sub of subChunks) {
      chunks.push({
        chunkIndex: chunkIndex++,
        text: sub,
      });
    }
  }

  return chunks;
}

function splitIntoSections(text: string): { heading?: string; text: string }[] {
  const lines = text.split("\n");
  const sections: { heading?: string; text: string }[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && SECTION_PATTERN.test(trimmed) && trimmed.length < 80) {
      if (currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          text: currentLines.join("\n").trim(),
        });
      }
      currentHeading = trimmed;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      text: currentLines.join("\n").trim(),
    });
  }

  if (sections.length === 0) {
    return [{ text }];
  }

  return sections.filter((s) => s.text.length > 0);
}

function splitLongText(
  text: string,
  maxChars: number,
  overlap: number
): string[] {
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n", end);
      if (breakAt > start + maxChars / 2) {
        end = breakAt;
      }
    }
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return parts.filter(Boolean);
}
