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
  measureTableBlockHeight,
} from "@/lib/generation/export-loi-pdf-tables";
import { wrapTextToWidth } from "@/lib/generation/pdf-text-wrap";

const MARGIN_X = 72;
const MARGIN_BOTTOM = 72;
const LETTERHEAD_HEIGHT = 100;
const FONT_SIZE = 11;
const HEADING_SIZE = 12;
const LINE_GAP = 4;
const FOOTER_SIZE = 9;

type LayoutState = {
  page: PDFPage;
  pageWidth: number;
  pageHeight: number;
  cursorY: number;
};

type EditedContext = {
  output: PDFDocument;
  template: PDFDocument;
  templatePage: PDFPage;
  fonts: { regular: PDFFont; bold: PDFFont };
  pageSize: { width: number; height: number };
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

async function createEditedContext(
  templatePdfBuffer: Buffer
): Promise<EditedContext> {
  const template = await PDFDocument.load(templatePdfBuffer);
  const output = await PDFDocument.create();
  const templatePage = template.getPages()[0];
  if (!templatePage) {
    throw new Error("Template PDF has no pages");
  }

  const { width, height } = templatePage.getSize();
  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);

  return {
    output,
    template,
    templatePage,
    fonts: { regular, bold },
    pageSize: { width, height },
  };
}

/** Page 1: template letterhead only; body zone is blank for redraw. */
async function addFirstPage(ctx: EditedContext): Promise<LayoutState> {
  const { width, height } = ctx.pageSize;
  const page = ctx.output.addPage([width, height]);
  const embedded = await ctx.output.embedPage(ctx.templatePage);
  page.drawPage(embedded, { x: 0, y: 0, width, height });

  const maskTop = height - LETTERHEAD_HEIGHT;
  if (maskTop > MARGIN_BOTTOM) {
    page.drawRectangle({
      x: 0,
      y: MARGIN_BOTTOM,
      width,
      height: maskTop - MARGIN_BOTTOM,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }

  return {
    page,
    pageWidth: width,
    pageHeight: height,
    cursorY: height - LETTERHEAD_HEIGHT,
  };
}

function addContinuationPage(ctx: EditedContext): LayoutState {
  const { width, height } = ctx.pageSize;
  const page = ctx.output.addPage([width, height]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });

  return {
    page,
    pageWidth: width,
    pageHeight: height,
    cursorY: height - MARGIN_X,
  };
}

async function ensureSpace(
  state: LayoutState,
  needed: number,
  ctx: EditedContext
): Promise<LayoutState> {
  if (state.cursorY - needed >= MARGIN_BOTTOM) {
    return state;
  }
  return addContinuationPage(ctx);
}

async function drawLines(
  state: LayoutState,
  lines: string[],
  font: PDFFont,
  fontSize: number,
  ctx: EditedContext
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
  ctx: EditedContext
): Promise<LayoutState> {
  const lines = wrapText(text, font, fontSize, maxTextWidth(state.pageWidth));
  return drawLines(state, lines, font, fontSize, ctx);
}

async function drawTable(
  state: LayoutState,
  rows: string[][],
  font: PDFFont,
  ctx: EditedContext
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
  ctx: EditedContext
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

function drawFooters(
  output: PDFDocument,
  templateFilename: string | null | undefined,
  font: PDFFont
) {
  const pages = output.getPages();
  const label = templateFilename
    ? `Template: ${templateFilename}`
    : "miniAviator LOI draft";

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
 * Export user-edited drafts: template letterhead on page 1, clean body redraw
 * on opaque pages (no ghost text from the template PDF).
 */
export async function exportLoiPdfEditedDraft(
  input: ExportDocumentInput,
  templatePdfBuffer: Buffer
): Promise<Buffer> {
  const ctx = await createEditedContext(templatePdfBuffer);
  let state = await addFirstPage(ctx);
  const segments = buildMergedExportSegments(input);

  for (const segment of segments) {
    state = await drawSegment(state, segment, ctx.fonts, ctx);
    if (segment.kind === "paragraph") {
      state = { ...state, cursorY: state.cursorY - 4 };
    }
  }

  drawFooters(ctx.output, input.templateFilename, ctx.fonts.regular);
  const bytes = await ctx.output.save();
  return Buffer.from(bytes);
}
