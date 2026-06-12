import type { ParsedPage } from "@/lib/parsing/parse-document";

export type ScoredPage = ParsedPage & {
  score: number;
  flags: {
    tableOfContents: boolean;
    coverOnly: boolean;
  };
};

export function getExtractionScanPages(): number {
  const parsed = parseInt(process.env.EXTRACTION_SCAN_PAGES ?? "25", 10);
  return Number.isNaN(parsed) || parsed < 1 ? 25 : parsed;
}

const METADATA_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /transaction parties/i, weight: 10 },
  { pattern: /parties to (?:this|the)/i, weight: 8 },
  { pattern: /\blessor\b/i, weight: 7 },
  { pattern: /\blessee\b/i, weight: 7 },
  { pattern: /\bseller\b/i, weight: 7 },
  { pattern: /\bbuyer\b/i, weight: 7 },
  { pattern: /\bpurchaser\b/i, weight: 6 },
  { pattern: /\bvendor\b/i, weight: 5 },
  { pattern: /aircraft type|aircraft model|type of aircraft/i, weight: 6 },
  { pattern: /\bmsn\b|manufacturer serial number|m\.s\.n\./i, weight: 8 },
  { pattern: /registration(?:\s+mark)?/i, weight: 6 },
  { pattern: /governing law|jurisdiction|laws of/i, weight: 6 },
  { pattern: /lease term|term of lease|indicative term/i, weight: 5 },
  { pattern: /monthly rent|basic rent|rental/i, weight: 6 },
  { pattern: /purchase price|sale price/i, weight: 6 },
  { pattern: /delivery date|target delivery/i, weight: 5 },
  { pattern: /security deposit|maintenance reserve/i, weight: 5 },
  { pattern: /operating lease|lease agreement|letter of intent/i, weight: 4 },
  { pattern: /number of aircraft|quantity of aircraft|aircraft quantity/i, weight: 8 },
  { pattern: /between\s+.+\s+and\s+/i, weight: 4 },
  { pattern: /maintenance reserves?/i, weight: 6 },
  { pattern: /^insurance$/im, weight: 6 },
  { pattern: /redelivery conditions?/i, weight: 6 },
  { pattern: /default interest/i, weight: 5 },
  { pattern: /cape town convention/i, weight: 5 },
  { pattern: /^notices$/im, weight: 4 },
];

const DOCUMENT_TITLE_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /letter of intent|\bloi\b/i, weight: 5 },
  { pattern: /operating lease agreement|\bola\b/i, weight: 5 },
  { pattern: /heads of terms|term sheet|memorandum of understanding/i, weight: 4 },
  { pattern: /aircraft purchase agreement|sale and purchase agreement/i, weight: 4 },
  { pattern: /lease agreement|purchase agreement/i, weight: 3 },
];

const TOC_LINE =
  /(?:\.{4,}\s*\d+\s*$|^\s*\d+(?:\.\d+)*\s+.+\s+\d+\s*$)/;

export function isTableOfContentsPage(text: string): boolean {
  const lower = text.toLowerCase();
  if (/table of contents|^contents\s*$|^index\s*$/im.test(lower)) {
    return true;
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;

  const tocLikeLines = lines.filter((line) => TOC_LINE.test(line));
  return tocLikeLines.length >= 3 && tocLikeLines.length / lines.length >= 0.35;
}

export function isCoverOnlyPage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 60) return true;

  const hasMetadataSignal = METADATA_SIGNALS.some(({ pattern }) =>
    pattern.test(trimmed)
  );
  if (hasMetadataSignal) return false;

  const wordCount = trimmed.split(/\s+/).length;
  if (trimmed.length < 350 && wordCount < 45) return true;

  return false;
}

export function scorePageText(text: string, pageNumber = 1): number {
  if (isTableOfContentsPage(text)) return -100;

  let score = 0;
  if (isCoverOnlyPage(text)) {
    score -= 15;
  }

  for (const { pattern, weight } of METADATA_SIGNALS) {
    if (pattern.test(text)) score += weight;
  }

  for (const { pattern, weight } of DOCUMENT_TITLE_SIGNALS) {
    if (pattern.test(text)) score += weight;
  }

  if (pageNumber === 1 && score > -100) {
    score += 2;
  }

  return score;
}

export function scorePages(pages: ParsedPage[]): ScoredPage[] {
  return pages.map((page) => {
    const tableOfContents = isTableOfContentsPage(page.text);
    const coverOnly = !tableOfContents && isCoverOnlyPage(page.text);
    return {
      ...page,
      score: scorePageText(page.text, page.pageNumber),
      flags: { tableOfContents, coverOnly },
    };
  });
}

export function selectExtractionPages(
  pages: ParsedPage[],
  maxPages: number,
  scanPages: number
): ParsedPage[] {
  if (pages.length === 0) return [];
  if (pages.length === 1) return pages;

  const scannable = pages.filter((p) => p.pageNumber <= scanPages);
  const scored = scorePages(scannable);

  const usable = scored.filter((p) => !p.flags.tableOfContents);
  const ranked = [...usable].sort((a, b) => b.score - a.score);

  const selectedNumbers = new Set<number>();

  const pageOne = usable.find((p) => p.pageNumber === 1);
  if (pageOne && pageOne.score > -100) {
    const hasTitleSignal = DOCUMENT_TITLE_SIGNALS.some(({ pattern }) =>
      pattern.test(pageOne.text)
    );
    if (hasTitleSignal || pageOne.score >= 0) {
      selectedNumbers.add(1);
    }
  }

  for (const page of ranked) {
    if (selectedNumbers.size >= maxPages) break;
    if (page.score <= 0 && selectedNumbers.size > 0) continue;
    selectedNumbers.add(page.pageNumber);
  }

  if (selectedNumbers.size === 0) {
    const fallback = usable.length > 0 ? usable : scored;
    return fallback.slice(0, maxPages).map(({ pageNumber, text }) => ({
      pageNumber,
      text,
    }));
  }

  return scannable.filter((p) => selectedNumbers.has(p.pageNumber));
}

/** Split DOCX / single-blob text into scorable sections. */
export function splitTextIntoSections(fullText: string): ParsedPage[] {
  const sections: ParsedPage[] = [];
  const lines = fullText.split("\n");
  let currentHeading: string | undefined;
  let currentLines: string[] = [];
  let sectionIndex = 0;

  const headingPattern =
    /^(?:\d+(?:\.\d+)*\.?\s+[A-Z]|TRANSACTION PARTIES|Schedule\s+\d+|[A-Z][A-Z\s\-\/]{4,50})$/;

  function pushSection() {
    const text = currentLines.join("\n").trim();
    if (text.length >= 40) {
      sectionIndex += 1;
      sections.push({
        pageNumber: sectionIndex,
        text: currentHeading ? `${currentHeading}\n${text}` : text,
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed &&
      headingPattern.test(trimmed) &&
      trimmed.length < 90 &&
      currentLines.join("\n").length > 80
    ) {
      pushSection();
      currentHeading = trimmed;
    } else {
      currentLines.push(line);
    }
  }
  pushSection();

  if (sections.length <= 1 && fullText.length > 5000) {
    return splitTextIntoWindows(fullText);
  }

  if (sections.length === 0) {
    return [{ pageNumber: 1, text: fullText }];
  }

  return sections;
}

const WINDOW_CHARS = 4500;
const WINDOW_OVERLAP = 400;

function splitTextIntoWindows(fullText: string): ParsedPage[] {
  const windows: ParsedPage[] = [];
  let start = 0;
  let index = 0;

  while (start < fullText.length) {
    index += 1;
    let end = Math.min(start + WINDOW_CHARS, fullText.length);
    if (end < fullText.length) {
      const breakAt = fullText.lastIndexOf("\n\n", end);
      if (breakAt > start + WINDOW_CHARS / 2) end = breakAt;
    }
    windows.push({
      pageNumber: index,
      text: fullText.slice(start, end).trim(),
    });
    if (end >= fullText.length) break;
    start = Math.max(end - WINDOW_OVERLAP, start + 1);
  }

  return windows.length > 0 ? windows : [{ pageNumber: 1, text: fullText }];
}

export function selectExtractionTextFromSections(
  fullText: string,
  maxPages: number
): string {
  const sections = splitTextIntoSections(fullText);
  if (sections.length <= maxPages) {
    return sections.map((s) => s.text).join("\n\n");
  }

  const selected = selectExtractionPages(sections, maxPages, sections.length);
  if (selected.length === 0) {
    return fullText.slice(0, maxPages * WINDOW_CHARS);
  }
  return selected.map((s) => s.text).join("\n\n");
}
