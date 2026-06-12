import type { ParsedDocument } from "@/lib/parsing/parse-document";
import {
  getExtractionScanPages,
  scorePages,
  selectExtractionPages,
  selectExtractionTextFromSections,
  splitTextIntoSections,
} from "@/lib/extraction/select-extraction-pages";

export function getExtractionMaxPages(): number {
  const parsed = parseInt(process.env.EXTRACTION_MAX_PAGES ?? "3", 10);
  return Number.isNaN(parsed) || parsed < 1 ? 3 : parsed;
}

export { getExtractionScanPages };

/**
 * Build text for LLM metadata extraction by scanning document pages/sections,
 * skipping front matter (cover, TOC), and selecting the most metadata-rich content.
 */
export function buildExtractionText(parsed: ParsedDocument): string {
  const maxPages = getExtractionMaxPages();
  const scanPages = getExtractionScanPages();

  if (parsed.pages.length > 1) {
    const selected = selectExtractionPages(parsed.pages, maxPages, scanPages);
    if (selected.length > 0) {
      return selected.map((p) => p.text.trim()).filter(Boolean).join("\n\n");
    }
  }

  return selectExtractionTextFromSections(parsed.fullText, maxPages);
}

export type ExtractionTextDebugInfo = {
  maxPages: number;
  scanPages: number;
  selectedPageNumbers: number[];
  selectedScores: number[];
};

/** For diagnostics: which pages/sections were chosen for extraction. */
export function describeExtractionSelection(
  parsed: ParsedDocument
): ExtractionTextDebugInfo {
  const maxPages = getExtractionMaxPages();
  const scanPages = getExtractionScanPages();

  const pages =
    parsed.pages.length > 1 ? parsed.pages : splitTextIntoSections(parsed.fullText);
  const selected = selectExtractionPages(pages, maxPages, scanPages);
  const scored = scorePages(pages);
  const scoreByPage = new Map(scored.map((p) => [p.pageNumber, p.score]));

  return {
    maxPages,
    scanPages,
    selectedPageNumbers: selected.map((p) => p.pageNumber),
    selectedScores: selected.map((p) => scoreByPage.get(p.pageNumber) ?? 0),
  };
}
