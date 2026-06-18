export type PdfTextBox = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PdfLineGroup = {
  pageIndex: number;
  y: number;
  items: Array<{
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
  }>;
  text: string;
};

function itemFontSize(transform: number[]): number {
  return Math.max(Math.abs(transform[0] ?? 11), Math.abs(transform[3] ?? 11));
}

function normalizeForSearch(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function groupPageLines(pageIndex: number, items: PdfTextItem[]): PdfLineGroup[] {
  const mapped = items
    .map((item) => {
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      return {
        str: item.str,
        x,
        y,
        width: item.width,
        height: item.height || itemFontSize(item.transform),
        fontSize: itemFontSize(item.transform),
      };
    })
    .filter((item) => item.str.trim().length > 0);

  mapped.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: PdfLineGroup[] = [];
  for (const item of mapped) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= 2.5);
    if (existing) {
      existing.items.push(item);
      existing.items.sort((a, b) => a.x - b.x);
      existing.text = existing.items.map((part) => part.str).join(" ");
    } else {
      lines.push({
        pageIndex,
        y: item.y,
        items: [item],
        text: item.str,
      });
    }
  }

  return lines;
}

function unionBox(
  items: PdfLineGroup["items"]
): Pick<PdfTextBox, "x" | "y" | "width" | "height" | "fontSize"> {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const top = Math.max(...items.map((item) => item.y + item.height));
  return {
    x,
    y,
    width: Math.max(right - x, 8),
    height: Math.max(top - y, 8),
    fontSize: items.reduce((max, item) => Math.max(max, item.fontSize), 11),
  };
}

function findOnLine(line: PdfLineGroup, needle: string): PdfTextBox | null {
  const haystack = line.text;
  const index = normalizeForSearch(haystack).indexOf(normalizeForSearch(needle));
  if (index < 0) return null;

  let cursor = 0;
  const selected: PdfLineGroup["items"] = [];
  for (const item of line.items) {
    const start = cursor;
    const end = cursor + item.str.length;
    const matchStart = index;
    const matchEnd = index + needle.length;
    if (end > matchStart && start < matchEnd) {
      selected.push(item);
    }
    cursor = end + 1;
  }

  if (selected.length === 0) return null;
  const box = unionBox(selected);
  return {
    pageIndex: line.pageIndex,
    ...box,
    text: haystack.slice(index, index + needle.length),
  };
}

function findAcrossLines(lines: PdfLineGroup[], needle: string): PdfTextBox | null {
  if (lines.length === 0) return null;

  const pageIndex = lines[0].pageIndex;
  const joined = lines.map((line) => line.text).join(" ");
  const normalizedJoined = normalizeForSearch(joined);
  const normalizedNeedle = normalizeForSearch(needle);
  const index = normalizedJoined.indexOf(normalizedNeedle);
  if (index < 0) return null;

  const matchEnd = index + normalizedNeedle.length;
  let cursor = 0;
  const selected: PdfLineGroup["items"] = [];

  for (const line of lines) {
    const lineStart = cursor;
    const lineText = line.text;
    const lineEnd = lineStart + lineText.length;

    for (const item of line.items) {
      const itemIndex = lineText.indexOf(item.str);
      if (itemIndex < 0) continue;
      const itemStart = lineStart + itemIndex;
      const itemEnd = itemStart + item.str.length;
      if (itemEnd > index && itemStart < matchEnd) {
        selected.push(item);
      }
    }

    cursor = lineEnd + 1;
  }

  if (selected.length === 0) return null;
  const box = unionBox(selected);
  return {
    pageIndex,
    ...box,
    text: joined.slice(index, index + needle.length),
  };
}

function dedupeBoxes(boxes: PdfTextBox[]): PdfTextBox[] {
  const kept: PdfTextBox[] = [];
  for (const box of boxes) {
    const duplicate = kept.some(
      (existing) =>
        existing.pageIndex === box.pageIndex &&
        Math.abs(existing.x - box.x) < 4 &&
        Math.abs(existing.y - box.y) < 4
    );
    if (!duplicate) kept.push(box);
  }
  return kept;
}

/** Extract bounding boxes for each occurrence of search text in a PDF. */
export async function findTextBoxesInPdf(
  pdfBuffer: Buffer,
  searchText: string
): Promise<PdfTextBox[]> {
  const needle = searchText.trim();
  if (!needle) return [];

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const hits: PdfTextBox[] = [];
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const lines = groupPageLines(pageIndex, content.items as PdfTextItem[]);

    for (const line of lines) {
      const hit = findOnLine(line, needle);
      if (hit) hits.push(hit);
    }

    const crossLineHit = findAcrossLines(lines, needle);
    if (crossLineHit) hits.push(crossLineHit);
  }

  return dedupeBoxes(hits);
}
