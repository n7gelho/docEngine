import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";
import { buildMergedExportSegments } from "@/lib/generation/export-loi-shared";
import { sanitizeForPdfLib } from "@/lib/generation/export-loi-normalize";
import {
  drawBorderedPdfTable,
  tableBlockHeight,
} from "@/lib/generation/export-loi-pdf-tables";

const MARGIN_X = 72;
const MARGIN_BOTTOM = 72;
const LETTERHEAD_HEIGHT = 100;
const RUNNING_HEADER_HEIGHT = 40;
const FONT_SIZE = 11;
const HEADING_SIZE = 12;
const LINE_GAP = 4;
const TABLE_ROW_GAP = 2;

type LayoutState = {
  page: PDFPage;
  pageWidth: number;
  pageHeight: number;
  cursorY: number;
};

type PreserveContext = {
  output: PDFDocument;
  template: PDFDocument;
  templatePages: PDFPage[];
  fonts: { regular: PDFFont; bold: PDFFont };
  nextPageIndex: number;
};

function lineHeight(size: number): number {
  return size + LINE_GAP;
}

function maxTextWidth(pageWidth: number): number {
  return pageWidth - MARGIN_X * 2;
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const safe = sanitizeForPdfLib(text);
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function maskBodyArea(
  page: PDFPage,
  width: number,
  height: number,
  topReserved: number,
  fullPage = false
) {
  const maskHeight = fullPage
    ? height - topReserved - MARGIN_BOTTOM
    : height - topReserved - MARGIN_BOTTOM;
  if (maskHeight <= 0) return;
  page.drawRectangle({
    x: fullPage ? 0 : MARGIN_X,
    y: MARGIN_BOTTOM,
    width: fullPage ? width : width - MARGIN_X * 2,
    height: maskHeight,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
}

async function addPreservePage(ctx: PreserveContext): Promise<LayoutState> {
  const templateIndex = Math.min(
    ctx.nextPageIndex,
    ctx.templatePages.length - 1
  );
  const templatePage = ctx.templatePages[templateIndex];
  const { width, height } = templatePage.getSize();
  const isFirstOutputPage = ctx.nextPageIndex === 0;
  const topReserved = isFirstOutputPage
    ? LETTERHEAD_HEIGHT
    : RUNNING_HEADER_HEIGHT;

  const page = ctx.output.addPage([width, height]);
  const embedded = await ctx.output.embedPage(templatePage);
  page.drawPage(embedded, { x: 0, y: 0, width, height });
  maskBodyArea(page, width, height, topReserved, isFirstOutputPage);

  ctx.nextPageIndex += 1;

  return {
    page,
    pageWidth: width,
    pageHeight: height,
    cursorY: height - topReserved,
  };
}

async function ensureSpace(
  state: LayoutState,
  needed: number,
  ctx: PreserveContext
): Promise<LayoutState> {
  if (state.cursorY - needed >= MARGIN_BOTTOM) {
    return state;
  }
  return addPreservePage(ctx);
}

async function drawLines(
  state: LayoutState,
  lines: string[],
  font: PDFFont,
  fontSize: number,
  ctx: PreserveContext
): Promise<LayoutState> {
  let current = state;
  const height = lineHeight(fontSize);

  for (const line of lines) {
    current = await ensureSpace(current, height, ctx);
    current.page.drawText(line, {
      x: MARGIN_X,
      y: current.cursorY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    current = { ...current, cursorY: current.cursorY - height };
  }

  return current;
}

async function drawParagraph(
  state: LayoutState,
  text: string,
  font: PDFFont,
  fontSize: number,
  ctx: PreserveContext
): Promise<LayoutState> {
  const lines = wrapText(text, font, fontSize, maxTextWidth(state.pageWidth));
  return drawLines(state, lines, font, fontSize, ctx);
}

async function drawTable(
  state: LayoutState,
  rows: string[][],
  font: PDFFont,
  ctx: PreserveContext
): Promise<LayoutState> {
  if (rows.length === 0) return state;

  const needed = tableBlockHeight(rows.length) + 8;
  let current = await ensureSpace(state, needed, ctx);
  const tableHeight = drawBorderedPdfTable(
    current.page,
    rows.map((row) => row.map((cell) => sanitizeForPdfLib(cell))),
    {
      x: MARGIN_X,
      y: current.cursorY,
      width: maxTextWidth(current.pageWidth),
    },
    font,
    { fontSize: FONT_SIZE, headerRow: true }
  );
  return { ...current, cursorY: current.cursorY - tableHeight - 8 };
}

async function drawSegment(
  state: LayoutState,
  segment: ExportContentSegment,
  fonts: { regular: PDFFont; bold: PDFFont },
  ctx: PreserveContext
): Promise<LayoutState> {
  switch (segment.kind) {
    case "heading": {
      let current = await ensureSpace(
        state,
        lineHeight(HEADING_SIZE) + 6,
        ctx
      );
      current = { ...current, cursorY: current.cursorY - 6 };
      return drawParagraph(current, segment.text, fonts.bold, HEADING_SIZE, ctx);
    }
    case "paragraph":
      return drawParagraph(state, segment.text, fonts.regular, FONT_SIZE, ctx);
    case "table":
      return drawTable(state, segment.rows, fonts.regular, ctx);
    default:
      return state;
  }
}

async function drawSegments(
  state: LayoutState,
  segments: ExportContentSegment[],
  fonts: { regular: PDFFont; bold: PDFFont },
  ctx: PreserveContext
): Promise<LayoutState> {
  let current = state;
  for (const segment of segments) {
    current = await drawSegment(current, segment, fonts, ctx);
    if (segment.kind === "paragraph") {
      current = { ...current, cursorY: current.cursorY - 4 };
    }
  }
  return current;
}

/**
 * Export using template donor PDF pages as visual backgrounds.
 * Template letterhead/headers stay visible; body text is masked and redrawn once.
 */
export async function exportLoiPdfPreserveTemplate(
  input: ExportDocumentInput,
  templatePdfBuffer: Buffer
): Promise<Buffer> {
  const template = await PDFDocument.load(templatePdfBuffer);
  const templatePages = template.getPages();
  if (templatePages.length === 0) {
    throw new Error("Template PDF has no pages");
  }

  const output = await PDFDocument.create();
  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);

  const ctx: PreserveContext = {
    output,
    template,
    templatePages,
    fonts: { regular, bold },
    nextPageIndex: 0,
  };

  let state = await addPreservePage(ctx);
  const segments = buildMergedExportSegments(input);
  await drawSegments(state, segments, ctx.fonts, ctx);

  const bytes = await output.save();
  return Buffer.from(bytes);
}
