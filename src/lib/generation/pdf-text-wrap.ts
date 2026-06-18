import type { PDFFont } from "pdf-lib";

const CELL_PADDING = 4;

/** Break overlong tokens so wrapping can stay within maxWidth. */
function breakLongToken(
  token: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (font.widthOfTextAtSize(token, fontSize) <= maxWidth) return [token];

  const parts: string[] = [];
  let chunk = "";
  for (const char of token) {
    const candidate = chunk + char;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      chunk = candidate;
      continue;
    }
    if (chunk) parts.push(chunk);
    chunk = char;
  }
  if (chunk) parts.push(chunk);
  return parts.length > 0 ? parts : [token];
}

/** Wrap text to fit within maxWidth using font metrics. */
export function wrapTextToWidth(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (!text.trim() || maxWidth <= 0) return [];

  const words = text.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const word of words) {
    tokens.push(...breakLongToken(word, font, fontSize, maxWidth));
  }

  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = token;
  }
  if (current) lines.push(current);
  return lines;
}

export function pdfLineHeight(fontSize: number, gap = 2): number {
  return fontSize + gap;
}

export function tableCellPadding(): number {
  return CELL_PADDING;
}

export function measureWrappedCellHeight(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): number {
  const lines = wrapTextToWidth(text, font, fontSize, maxWidth);
  const lineCount = Math.max(lines.length, 1);
  return lineCount * pdfLineHeight(fontSize) + CELL_PADDING * 2;
}
