import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";

import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";
import {
  buildDealSummaryRows,
  buildMergedExportSegments,
  type DealSummaryRow,
  type ExportDocumentInput,
} from "@/lib/generation/export-loi-shared";
import { sanitizeForPdfLib } from "@/lib/generation/export-loi-normalize";
import {
  drawBorderedPdfTable,
  measureTableBlockHeight,
} from "@/lib/generation/export-loi-pdf-tables";
import { wrapTextToWidth } from "@/lib/generation/pdf-text-wrap";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 72;
const MARGIN_BOTTOM = 72;
const BODY_TOP = 72;
const FONT_SIZE = 11;
const HEADING_SIZE = 12;
const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 12;
const LINE_GAP = 4;
const FOOTER_SIZE = 9;
const SUMMARY_LABEL_RATIO = 0.34;

type LayoutState = {
  page: PDFPage;
  pageWidth: number;
  pageHeight: number;
  cursorY: number;
};

type HouseContext = {
  output: PDFDocument;
  fonts: { regular: PDFFont; bold: PDFFont };
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
  return wrapTextToWidth(sanitizeForPdfLib(text), font, fontSize, maxWidth);
}

async function createHouseContext(): Promise<HouseContext> {
  const output = await PDFDocument.create();
  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);
  return { output, fonts: { regular, bold } };
}

function addPage(ctx: HouseContext): LayoutState {
  const page = ctx.output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
  return {
    page,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    cursorY: PAGE_HEIGHT - BODY_TOP,
  };
}

function drawLetterhead(
  state: LayoutState,
  input: ExportDocumentInput,
  fonts: { regular: PDFFont; bold: PDFFont }
): LayoutState {
  const { page, pageWidth, pageHeight } = state;
  const bandHeight = 96;
  const bandBottom = pageHeight - bandHeight;

  page.drawRectangle({
    x: 0,
    y: bandBottom,
    width: pageWidth,
    height: bandHeight,
    color: rgb(0.97, 0.97, 0.98),
    borderWidth: 0,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: bandBottom },
    end: { x: pageWidth - MARGIN_X, y: bandBottom },
    thickness: 1,
    color: rgb(0.75, 0.75, 0.78),
  });

  const title = "LETTER OF INTENT";
  const titleWidth = fonts.bold.widthOfTextAtSize(title, TITLE_SIZE);
  page.drawText(title, {
    x: (pageWidth - titleWidth) / 2,
    y: pageHeight - 42,
    size: TITLE_SIZE,
    font: fonts.bold,
    color: rgb(0.1, 0.1, 0.15),
  });

  const docTitle =
    input.content.documentTitle?.trim() ||
    input.templateFilename?.replace(/\.[^.]+$/, "") ||
    null;
  if (docTitle) {
    const subtitle = sanitizeForPdfLib(docTitle);
    const subtitleWidth = fonts.regular.widthOfTextAtSize(subtitle, SUBTITLE_SIZE);
    page.drawText(subtitle, {
      x: (pageWidth - Math.min(subtitleWidth, maxTextWidth(pageWidth))) / 2,
      y: pageHeight - 64,
      size: SUBTITLE_SIZE,
      font: fonts.regular,
      color: rgb(0.25, 0.25, 0.3),
    });
  }

  if (input.templateFilename) {
    const ref = `Based on precedent: ${sanitizeForPdfLib(input.templateFilename)}`;
    const refWidth = fonts.regular.widthOfTextAtSize(ref, 9);
    page.drawText(ref, {
      x: (pageWidth - refWidth) / 2,
      y: pageHeight - 82,
      size: 9,
      font: fonts.regular,
      color: rgb(0.45, 0.45, 0.5),
    });
  }

  return {
    ...state,
    cursorY: bandBottom - 20,
  };
}

function measureSummaryBoxHeight(
  rows: DealSummaryRow[],
  boxWidth: number,
  fonts: { regular: PDFFont; bold: PDFFont }
): number {
  if (rows.length === 0) return 0;

  const labelColWidth = boxWidth * SUMMARY_LABEL_RATIO;
  const valueColWidth = boxWidth * (1 - SUMMARY_LABEL_RATIO);
  const padding = 8;
  const innerLabel = labelColWidth - padding * 2;
  const innerValue = valueColWidth - padding * 2;

  let total = 12;
  for (const row of rows) {
    const labelH = measureWrappedHeight(row.label, fonts.bold, FONT_SIZE, innerLabel);
    const valueH = measureWrappedHeight(row.value, fonts.regular, FONT_SIZE, innerValue);
    total += Math.max(labelH, valueH) + 6;
  }
  return total + 8;
}

function measureWrappedHeight(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): number {
  const lines = wrapText(text, font, fontSize, maxWidth);
  return Math.max(lineHeight(fontSize), lines.length * lineHeight(fontSize));
}

function drawSummaryBox(
  state: LayoutState,
  rows: DealSummaryRow[],
  fonts: { regular: PDFFont; bold: PDFFont }
): LayoutState {
  if (rows.length === 0) return state;

  const boxWidth = maxTextWidth(state.pageWidth);
  const boxHeight = measureSummaryBoxHeight(rows, boxWidth, fonts);
  const boxTop = state.cursorY;
  const boxBottom = boxTop - boxHeight;

  state.page.drawRectangle({
    x: MARGIN_X,
    y: boxBottom,
    width: boxWidth,
    height: boxHeight,
    borderColor: rgb(0.55, 0.55, 0.58),
    borderWidth: 1,
    color: rgb(0.99, 0.99, 1),
  });

  state.page.drawText("Deal summary", {
    x: MARGIN_X + 10,
    y: boxTop - 18,
    size: HEADING_SIZE,
    font: fonts.bold,
    color: rgb(0.1, 0.1, 0.15),
  });

  const labelColWidth = boxWidth * SUMMARY_LABEL_RATIO;
  const valueColWidth = boxWidth * (1 - SUMMARY_LABEL_RATIO);
  const padding = 8;
  let rowTop = boxTop - 30;

  for (const row of rows) {
    const labelLines = wrapText(
      row.label,
      fonts.bold,
      FONT_SIZE,
      labelColWidth - padding * 2
    );
    const valueLines = wrapText(
      row.value,
      fonts.regular,
      FONT_SIZE,
      valueColWidth - padding * 2
    );
    const rowHeight =
      Math.max(labelLines.length, valueLines.length) * lineHeight(FONT_SIZE) + 4;

    let labelY = rowTop - FONT_SIZE;
    for (const line of labelLines) {
      state.page.drawText(line, {
        x: MARGIN_X + padding,
        y: labelY,
        size: FONT_SIZE,
        font: fonts.bold,
        color: rgb(0.15, 0.15, 0.2),
      });
      labelY -= lineHeight(FONT_SIZE);
    }

    let valueY = rowTop - FONT_SIZE;
    for (const line of valueLines) {
      state.page.drawText(line, {
        x: MARGIN_X + labelColWidth + padding,
        y: valueY,
        size: FONT_SIZE,
        font: fonts.regular,
        color: rgb(0, 0, 0),
      });
      valueY -= lineHeight(FONT_SIZE);
    }

    rowTop -= rowHeight;
  }

  return { ...state, cursorY: boxBottom - 16 };
}

async function ensureSpace(
  state: LayoutState,
  needed: number,
  ctx: HouseContext
): Promise<LayoutState> {
  if (state.cursorY - needed >= MARGIN_BOTTOM) {
    return state;
  }
  return addPage(ctx);
}

async function drawLines(
  state: LayoutState,
  lines: string[],
  font: PDFFont,
  fontSize: number,
  ctx: HouseContext
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
  ctx: HouseContext
): Promise<LayoutState> {
  const lines = wrapText(text, font, fontSize, maxTextWidth(state.pageWidth));
  return drawLines(state, lines, font, fontSize, ctx);
}

async function drawTable(
  state: LayoutState,
  rows: string[][],
  font: PDFFont,
  ctx: HouseContext
): Promise<LayoutState> {
  if (rows.length === 0) return state;

  const tableWidth = maxTextWidth(state.pageWidth);
  const sanitized = rows.map((row) => row.map((cell) => sanitizeForPdfLib(cell)));
  const needed = measureTableBlockHeight(sanitized, tableWidth, font, FONT_SIZE) + 8;
  let current = await ensureSpace(state, needed, ctx);
  const tableHeight = drawBorderedPdfTable(
    current.page,
    sanitized,
    {
      x: MARGIN_X,
      y: current.cursorY,
      width: tableWidth,
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
  ctx: HouseContext
): Promise<LayoutState> {
  switch (segment.kind) {
    case "heading": {
      let current = await ensureSpace(state, lineHeight(HEADING_SIZE) + 8, ctx);
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

function drawFooters(output: PDFDocument, font: PDFFont) {
  const pages = output.getPages();
  const label = "miniAviator LOI";

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const text = `${label}  ·  Page ${index + 1} of ${pages.length}`;
    const textWidth = font.widthOfTextAtSize(text, FOOTER_SIZE);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 36,
      size: FOOTER_SIZE,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });
}

/**
 * Export using the owned miniAviator house LOI layout: drawn letterhead,
 * optional deal summary box, flowing body text, and bordered tables.
 */
export async function exportLoiPdfHouse(
  input: ExportDocumentInput
): Promise<Buffer> {
  const ctx = await createHouseContext();
  let state = addPage(ctx);
  state = drawLetterhead(state, input, ctx.fonts);

  const summaryRows = buildDealSummaryRows(input);
  state = drawSummaryBox(state, summaryRows, ctx.fonts);

  const segments = buildMergedExportSegments(input);
  for (const segment of segments) {
    state = await drawSegment(state, segment, ctx.fonts, ctx);
    if (segment.kind === "paragraph") {
      state = { ...state, cursorY: state.cursorY - 4 };
    }
  }

  drawFooters(ctx.output, ctx.fonts.regular);
  const bytes = await ctx.output.save();
  return Buffer.from(bytes);
}
