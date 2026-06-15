import type { ParsedPage } from "@/lib/parsing/parse-document";

/**
 * When pdf-parse does not emit form-feed page breaks, split full text into
 * estimated pages using paragraph boundaries and target page count.
 */
export function estimatePdfPages(fullText: string, numPages: number): ParsedPage[] {
  if (numPages <= 1 || fullText.length < 500) {
    return [{ pageNumber: 1, text: fullText }];
  }

  const targetChars = Math.ceil(fullText.length / numPages);
  const pages: ParsedPage[] = [];
  let start = 0;
  let pageNumber = 0;

  while (start < fullText.length && pageNumber < numPages) {
    pageNumber += 1;
    let end =
      pageNumber === numPages
        ? fullText.length
        : Math.min(start + targetChars, fullText.length);

    if (end < fullText.length && pageNumber < numPages) {
      const breakAt = fullText.lastIndexOf("\n\n", end);
      if (breakAt > start + targetChars * 0.5) end = breakAt;
    }

    const text = fullText.slice(start, end).trim();
    if (text) pages.push({ pageNumber, text });
    start = end;
  }

  return pages.length > 0 ? pages : [{ pageNumber: 1, text: fullText }];
}

/** Map 1-based PDF page number → character offset in fullText. */
export function pageCharOffsets(pages: ParsedPage[]): Map<number, number> {
  const offsets = new Map<number, number>();
  let cursor = 0;

  for (const page of pages) {
    offsets.set(page.pageNumber, cursor);
    const idx = page.text ? cursor : cursor;
    cursor = idx + (page.text?.length ?? 0) + 2;
  }

  // Recompute by searching sequential page text in full document
  return offsets;
}

export function findCharOffsetForPage(
  fullText: string,
  pages: ParsedPage[],
  pageNumber: number
): number | null {
  const page = pages.find((p) => p.pageNumber === pageNumber);
  if (!page?.text || page.text.length < 20) return null;

  const probe = page.text.slice(0, Math.min(80, page.text.length)).trim();
  const idx = fullText.indexOf(probe);
  return idx >= 0 ? idx : null;
}
