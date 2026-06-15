import type { ParsedPage } from "@/lib/parsing/parse-document";
import { findCharOffsetForPage } from "@/lib/parsing/estimate-pdf-pages";
import { getOlaSectionIds } from "@/lib/profiles/schema-registry";

export type TocEntry = {
  label: string;
  clauseRef?: string;
  pageRef?: number;
  rawLine: string;
};

export type TocParseResult = {
  found: boolean;
  tocStart: number;
  tocEnd: number;
  entries: TocEntry[];
  rawBlock: string;
};

export type TocMappedSection = {
  sectionId: string;
  tocLabel: string;
  clauseRef?: string;
  pageRef?: number;
};

/** Keyword patterns to map TOC labels → schema section ids. */
const SECTION_TOC_PATTERNS: Record<string, RegExp[]> = {
  parties_and_recitals: [
    /parties/i,
    /recitals?/i,
    /transaction parties/i,
    /between.*lessor/i,
    /between.*seller/i,
    /agreement/i,
  ],
  definitions_and_interpretation: [
    /definitions?/i,
    /interpretation/i,
  ],
  governing_law_and_jurisdiction: [
    /governing law/i,
    /jurisdiction/i,
    /further provisions/i,
  ],
  maintenance_reserves: [
    /maintenance/i,
    /repair/i,
    /reserves?/i,
  ],
  insurance: [/insurances?/i],
  redelivery_conditions: [/redelivery/i, /return conditions?/i],
  default_interest: [/default/i, /interest/i, /late payment/i],
  cape_town_convention: [/cape town/i, /international interest/i, /idera/i],
  notices: [/notices?/i],
};

const TOC_HEADER_PATTERNS: RegExp[] = [
  /TABLE\s+OF\s+CONTENTS/i,
  /^CONTENTS\s*$/im,
  /^INDEX\s*$/im,
  /LIST\s+OF\s+CONTENTS/i,
];

const TOC_LINE_PATTERNS: RegExp[] = [
  /^(?:CLAUSE|ARTICLE)\s+(\d+)\s+[-–—.]?\s*(.+?)\s*(?:\.{2,}|…+|\s{2,})\s*(\d{1,3})\s*$/i,
  /^(\d+(?:\.\d+)?)\s+[-–—.]?\s*(.+?)\s*(?:\.{2,}|…+|\s{2,})\s*(\d{1,3})\s*$/i,
  /^(?:CLAUSE|ARTICLE)\s+(\d+)\s+(.+?)\s+(\d{1,3})\s*$/i,
  /^(\d+)\.\s+(.+?)\s+(\d{1,3})\s*$/i,
  /^(\d+)\s+(.{3,60}?)\s{2,}(\d{1,3})\s*$/i,
];

function isLikelyTocLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4) return false;
  return (
    TOC_LINE_PATTERNS.some((p) => p.test(trimmed)) ||
    /(?:\.{3,}|…{2,})\s*\d{1,3}\s*$/.test(trimmed) ||
    /\s{3,}\d{1,3}\s*$/.test(trimmed)
  );
}

function parseTocLine(line: string): TocEntry | null {
  const trimmed = line.trim();
  for (const pattern of TOC_LINE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (!m) continue;
    const clauseRef = m[1]?.trim();
    const label = (m[2] ?? m[1])?.trim();
    const pageRef = parseInt(m[3] ?? "", 10);
    if (!label || label.length < 2) continue;
    return {
      label,
      clauseRef: /^\d/.test(clauseRef) ? clauseRef : undefined,
      pageRef: Number.isNaN(pageRef) ? undefined : pageRef,
      rawLine: trimmed,
    };
  }

  const dotsMatch = trimmed.match(/^(.+?)\s*(?:\.{3,}|…{2,}|\s{3,})\s*(\d{1,3})\s*$/);
  if (dotsMatch) {
    return {
      label: dotsMatch[1].trim(),
      pageRef: parseInt(dotsMatch[2], 10),
      rawLine: trimmed,
    };
  }

  return null;
}

function findTocHeaderIndex(fullText: string): { index: number; length: number } | null {
  for (const pattern of TOC_HEADER_PATTERNS) {
    const m = pattern.exec(fullText);
    if (m) return { index: m.index, length: m[0].length };
  }
  return null;
}

/** Locate TOC block boundaries in full document text. */
export function detectTocRegion(fullText: string): {
  tocStart: number;
  tocEnd: number;
} | null {
  const header = findTocHeaderIndex(fullText);
  if (!header) return null;

  const tocStart = header.index;
  const afterHeader = fullText.slice(tocStart + header.length);
  const lines = afterHeader.split("\n");

  let consumed = 0;
  let tocLineCount = 0;

  for (const line of lines) {
    if (tocLineCount > 2 && !isLikelyTocLine(line) && line.trim().length > 50) {
      break;
    }
    if (isLikelyTocLine(line) || (tocLineCount === 0 && line.trim().length < 3)) {
      tocLineCount += isLikelyTocLine(line) ? 1 : 0;
      consumed += line.length + 1;
      continue;
    }
    if (tocLineCount >= 3) break;
    consumed += line.length + 1;
  }

  const minEnd = tocStart + header.length + Math.min(consumed, 20_000);
  const bodyClauseRe =
    /(?:CLAUSE\s+\d+\s+[A-Z][A-Z\s]+\.\s+\d+\.\d+\s+[A-Z][a-z]+)/g;
  bodyClauseRe.lastIndex = minEnd;
  const bodyMatch = bodyClauseRe.exec(fullText);

  const tocEnd = bodyMatch
    ? Math.max(minEnd, bodyMatch.index - 200)
    : Math.min(tocStart + 15_000, fullText.length);

  return { tocStart, tocEnd };
}

export function parseTableOfContents(fullText: string): TocParseResult {
  const region = detectTocRegion(fullText);
  if (!region) {
    return {
      found: false,
      tocStart: 0,
      tocEnd: 0,
      entries: [],
      rawBlock: "",
    };
  }

  const rawBlock = fullText.slice(region.tocStart, region.tocEnd);
  const entries: TocEntry[] = [];

  for (const line of rawBlock.split("\n")) {
    const entry = parseTocLine(line);
    if (entry) entries.push(entry);
  }

  return {
    found: entries.length >= 2,
    tocStart: region.tocStart,
    tocEnd: region.tocEnd,
    entries,
    rawBlock,
  };
}

export function mapTocEntriesToSections(
  entries: TocEntry[]
): TocMappedSection[] {
  const sectionIds = getOlaSectionIds();
  const mapped: TocMappedSection[] = [];

  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    for (const sectionId of sectionIds) {
      const patterns = SECTION_TOC_PATTERNS[sectionId];
      if (!patterns?.some((p) => p.test(label))) continue;
      if (mapped.some((m) => m.sectionId === sectionId)) break;
      mapped.push({
        sectionId,
        tocLabel: entry.label,
        clauseRef: entry.clauseRef,
        pageRef: entry.pageRef,
      });
      break;
    }
  }

  return mapped;
}

function clauseSearchPatterns(clauseRef: string): RegExp[] {
  const num = clauseRef.replace(/\.\d+$/, "");
  return [
    new RegExp(`CLAUSE\\s+${num}\\s+[A-Z]`, "i"),
    new RegExp(`ARTICLE\\s+${num}[^a-zA-Z]`, "i"),
    new RegExp(`\\b${clauseRef.replace(".", "\\.")}\\s+[A-Za-z]`, "i"),
    new RegExp(`^\\s*${num}\\.\\s+[A-Z]`, "im"),
    new RegExp(`${num}\\.1\\s+[A-Z]`, "i"),
  ];
}

function searchFromOffset(
  fullText: string,
  patterns: RegExp[],
  searchFrom: number,
  searchLimit = 120_000
): number | null {
  const slice = fullText.slice(searchFrom, searchFrom + searchLimit);
  for (const pattern of patterns) {
    const m = pattern.exec(slice);
    if (m) return searchFrom + m.index;
  }
  return null;
}

/** Find body-text start index for a TOC-mapped section. */
export function findBodyIndexForTocSection(
  fullText: string,
  mapped: TocMappedSection,
  searchFrom: number,
  pages?: ParsedPage[]
): number | null {
  // Page-aware: start search near TOC page reference
  if (mapped.pageRef && pages && pages.length > 1) {
    const pageOffset = findCharOffsetForPage(fullText, pages, mapped.pageRef);
    if (pageOffset !== null) {
      const windowStart = Math.max(searchFrom, pageOffset - 400);
      if (mapped.clauseRef) {
        const hit = searchFromOffset(
          fullText,
          clauseSearchPatterns(mapped.clauseRef),
          windowStart,
          25_000
        );
        if (hit !== null) return hit;
      }
      const labelPattern = new RegExp(
        mapped.tocLabel
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .slice(0, 50),
        "i"
      );
      const labelHit = searchFromOffset(fullText, [labelPattern], windowStart, 25_000);
      if (labelHit !== null) return labelHit;
    }
  }

  if (mapped.clauseRef) {
    const hit = searchFromOffset(
      fullText,
      clauseSearchPatterns(mapped.clauseRef),
      searchFrom
    );
    if (hit !== null) return hit;
  }

  const labelPattern = new RegExp(
    mapped.tocLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 60),
    "i"
  );
  const labelMatch = labelPattern.exec(fullText.slice(searchFrom));
  if (labelMatch && labelMatch.index < 200_000) {
    return searchFrom + labelMatch.index;
  }

  const keywords = SECTION_TOC_PATTERNS[mapped.sectionId];
  if (keywords) {
    for (const kw of keywords) {
      const m = kw.exec(fullText.slice(searchFrom));
      if (m && m.index > 0) return searchFrom + m.index;
    }
  }

  return null;
}

export const MAX_SECTION_CHARS = 16_000;

export function buildTocSectionBoundaries(
  fullText: string,
  mappedSections: TocMappedSection[],
  bodyStart: number,
  pages?: ParsedPage[]
): Array<{
  sectionId: string;
  tocLabel: string;
  startIndex: number;
  endIndex: number;
}> {
  const located = mappedSections
    .map((mapped) => {
      const startIndex = findBodyIndexForTocSection(
        fullText,
        mapped,
        bodyStart,
        pages
      );
      if (startIndex === null) return null;
      return { ...mapped, startIndex };
    })
    .filter((x): x is TocMappedSection & { startIndex: number } => x !== null)
    .sort((a, b) => a.startIndex - b.startIndex);

  return located.map((section, i) => {
    const nextStart = located[i + 1]?.startIndex ?? fullText.length;
    const endIndex = Math.min(
      nextStart,
      section.startIndex + MAX_SECTION_CHARS,
      fullText.length
    );
    return {
      sectionId: section.sectionId,
      tocLabel: section.tocLabel,
      startIndex: Math.max(0, section.startIndex - 150),
      endIndex,
    };
  });
}

/** Build orientation string for LLM prompts from mapped TOC entries. */
export function buildTocOrientationBlock(
  mapped: TocMappedSection[],
  currentSectionId: string
): string {
  const idx = mapped.findIndex((m) => m.sectionId === currentSectionId);
  if (idx < 0) return "";

  const lines = [`- This section: ${mapped[idx].tocLabel}`];
  if (mapped[idx].clauseRef) lines.push(`- Clause ref: ${mapped[idx].clauseRef}`);
  if (mapped[idx].pageRef) lines.push(`- TOC page: ${mapped[idx].pageRef}`);
  if (mapped[idx - 1]) lines.push(`- Preceded by: ${mapped[idx - 1].tocLabel}`);
  if (mapped[idx + 1]) lines.push(`- Followed by: ${mapped[idx + 1].tocLabel}`);

  return lines.join("\n");
}
