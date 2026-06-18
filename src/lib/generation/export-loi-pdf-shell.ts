import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";
import {
  allBodySegments,
  closingSegments,
  draftHasFullContent,
  preambleSegments,
} from "@/lib/generation/export-loi-shared";
import { sanitizeForPdfLib } from "@/lib/generation/export-loi-normalize";

const MARGIN_X = 72;
const MARGIN_BOTTOM = 72;
const BODY_TOP = 72;
const FONT_SIZE = 11;
const HEADING_SIZE = 12;
const LINE_GAP = 4;
const TABLE_ROW_GAP = 2;
const FOOTER_SIZE = 9;

type LayoutState = {
  page: PDFPage;
  pageWidth: number;
  pageHeight: number;
  cursorY: number;
  pageIndex: number;
  pageCount: number;
};

function lineHeight(size: number): number {
  return size + LINE_GAP;
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
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function maxTextWidth(pageWidth: number): number {
  return pageWidth - MARGIN_X * 2;
}

async function createOutputDoc(
  templatePdfBuffer: Buffer
): Promise<{
  output: PDFDocument;
  template: PDFDocument;
  templatePage: ReturnType<PDFDocument["getPages"]>[number];
  fonts: { regular: PDFFont; bold: PDFFont };
}> {
  const template = await PDFDocument.load(templatePdfBuffer);
  const output = await PDFDocument.create();
  const templatePage = template.getPages()[0];
  if (!templatePage) {
    throw new Error("Template PDF has no pages");
  }

  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);

  return {
    output,
    template,
    templatePage,
    fonts: { regular, bold },
  };
}

async function addPage(
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  const { width, height } = templatePage.getSize();
  const page = output.addPage([width, height]);

  return {
    page,
    pageWidth: width,
    pageHeight: height,
    cursorY: height - BODY_TOP,
    pageIndex: output.getPageCount() - 1,
    pageCount: output.getPageCount(),
  };
}

function ensureSpace(
  state: LayoutState,
  needed: number,
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  if (state.cursorY - needed >= MARGIN_BOTTOM) {
    return Promise.resolve(state);
  }
  return addPage(output, template, templatePage);
}

async function drawLines(
  state: LayoutState,
  lines: string[],
  font: PDFFont,
  fontSize: number,
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  let current = state;
  const height = lineHeight(fontSize);

  for (const line of lines) {
    current = await ensureSpace(
      current,
      height,
      output,
      template,
      templatePage
    );
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
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  const lines = wrapText(text, font, fontSize, maxTextWidth(state.pageWidth));
  return drawLines(
    state,
    lines,
    font,
    fontSize,
    output,
    template,
    templatePage
  );
}

async function drawTable(
  state: LayoutState,
  rows: string[][],
  font: PDFFont,
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  if (rows.length === 0) return state;

  const colCount = Math.max(...rows.map((r) => r.length));
  const usableWidth = maxTextWidth(state.pageWidth);
  const colWeights = Array.from({ length: colCount }, (_, col) =>
    Math.max(
      ...rows.map((row) =>
        font.widthOfTextAtSize(sanitizeForPdfLib(row[col] ?? ""), FONT_SIZE)
      ),
      40
    )
  );
  const totalWeight = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (w / totalWeight) * usableWidth);
  const rowHeight = lineHeight(FONT_SIZE) + TABLE_ROW_GAP + 4;

  let current = state;
  for (const row of rows) {
    current = await ensureSpace(
      current,
      rowHeight,
      output,
      template,
      templatePage
    );

    let x = MARGIN_X;
    for (let col = 0; col < colCount; col++) {
      const cell = sanitizeForPdfLib(row[col] ?? "");
      current.page.drawText(cell, {
        x: x + 2,
        y: current.cursorY,
        size: FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
        maxWidth: colWidths[col] - 4,
      });
      x += colWidths[col];
    }

    current = { ...current, cursorY: current.cursorY - rowHeight };
  }

  return { ...current, cursorY: current.cursorY - LINE_GAP };
}

async function drawSegment(
  state: LayoutState,
  segment: ExportContentSegment,
  fonts: { regular: PDFFont; bold: PDFFont },
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  switch (segment.kind) {
    case "heading": {
      let current = await ensureSpace(
        state,
        lineHeight(HEADING_SIZE) + 6,
        output,
        template,
        templatePage
      );
      current = { ...current, cursorY: current.cursorY - 6 };
      return drawParagraph(
        current,
        segment.text,
        fonts.bold,
        HEADING_SIZE,
        output,
        template,
        templatePage
      );
    }
    case "paragraph":
      return drawParagraph(
        state,
        segment.text,
        fonts.regular,
        FONT_SIZE,
        output,
        template,
        templatePage
      );
    case "table":
      return drawTable(
        state,
        segment.rows,
        fonts.regular,
        output,
        template,
        templatePage
      );
    default:
      return state;
  }
}

async function drawSegments(
  state: LayoutState,
  segments: ExportContentSegment[],
  fonts: { regular: PDFFont; bold: PDFFont },
  output: PDFDocument,
  template: PDFDocument,
  templatePage: ReturnType<PDFDocument["getPages"]>[number]
): Promise<LayoutState> {
  let current = state;
  for (const segment of segments) {
    current = await drawSegment(
      current,
      segment,
      fonts,
      output,
      template,
      templatePage
    );
    if (segment.kind === "paragraph") {
      current = { ...current, cursorY: current.cursorY - 4 };
    }
  }
  return current;
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

export async function exportLoiPdfWithTemplateShell(
  input: ExportDocumentInput,
  templatePdfBuffer: Buffer
): Promise<Buffer> {
  const { output, template, templatePage, fonts } =
    await createOutputDoc(templatePdfBuffer);

  let state = await addPage(output, template, templatePage);

  const preamble = preambleSegments(input);
  if (preamble.length > 0) {
    state = await drawSegments(
      state,
      preamble,
      fonts,
      output,
      template,
      templatePage
    );
    state = { ...state, cursorY: state.cursorY - 12 };
  }

  state = await drawSegments(
    state,
    allBodySegments(input),
    fonts,
    output,
    template,
    templatePage
  );

  const closing = closingSegments(input);
  if (closing.length > 0) {
    state = { ...state, cursorY: state.cursorY - 16 };
    state = await drawSegments(
      state,
      closing,
      fonts,
      output,
      template,
      templatePage
    );
  }

  drawFooters(output, input.templateFilename, fonts.regular);
  const bytes = await output.save();
  return Buffer.from(bytes);
}

export function canUseTemplatePdfShell(
  input: ExportDocumentInput
): input is ExportDocumentInput & { templatePdfBuffer: Buffer } {
  if (draftHasFullContent(input)) return false;
  return (
    !!input.templatePdfBuffer &&
    input.templatePdfBuffer.length > 0 &&
    (input.templateMimeType === "application/pdf" ||
      input.templateFilename?.toLowerCase().endsWith(".pdf") === true)
  );
}
