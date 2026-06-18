import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";
import {
  buildDealSummaryRows,
  buildMergedExportSegments,
  resolveExportFooterLabel,
} from "@/lib/generation/export-loi-shared";

const BODY_FONT = "Times New Roman";
const BODY_SIZE = 22;
const TITLE_SIZE = 28;

function bodyParagraph(
  text: string,
  options?: { bold?: boolean; spacingAfter?: number }
) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: options?.spacingAfter ?? 180, line: 276 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: options?.bold,
      }),
    ],
  });
}

function headingParagraph(text: string) {
  return new Paragraph({
    spacing: { before: 220, after: 100 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: true,
      }),
    ],
  });
}

function subheadingParagraph(text: string) {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: true,
      }),
    ],
  });
}

function titleParagraph(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: TITLE_SIZE,
        bold: true,
      }),
    ],
  });
}

function subtitleParagraph(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        color: "444444",
      }),
    ],
  });
}

function summaryTable(rows: Array<{ label: string; value: string }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            shading: { fill: "F7F7FA" },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Deal summary",
                    font: BODY_FONT,
                    size: BODY_SIZE,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 34, type: WidthType.PERCENTAGE },
                margins: { top: 80, bottom: 80, left: 120, right: 80 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: row.label,
                        font: BODY_FONT,
                        size: BODY_SIZE,
                        bold: true,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 66, type: WidthType.PERCENTAGE },
                margins: { top: 80, bottom: 80, left: 80, right: 120 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: row.value,
                        font: BODY_FONT,
                        size: BODY_SIZE,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
      ),
    ],
  });
}

function tableBlock(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                shading:
                  rowIndex === 0 ? { fill: "F2F2F2" } : undefined,
                margins: {
                  top: 80,
                  bottom: 80,
                  left: 120,
                  right: 120,
                },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell,
                        font: BODY_FONT,
                        size: BODY_SIZE,
                        bold: rowIndex === 0,
                      }),
                    ],
                  }),
                ],
              })
          ),
        })
    ),
  });
}

function segmentToBlocks(
  segment: ExportContentSegment
): Array<Paragraph | Table> {
  switch (segment.kind) {
    case "heading":
      return [headingParagraph(segment.text)];
    case "subheading":
      return [subheadingParagraph(segment.text)];
    case "paragraph":
      return [bodyParagraph(segment.text)];
    case "table":
      return [tableBlock(segment.rows)];
    default:
      return [];
  }
}

export async function exportLoiAsDocx(
  input: ExportDocumentInput
): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  children.push(
    titleParagraph(input.content.letterheadTitle?.trim() || "LETTER OF INTENT")
  );

  const docTitle =
    input.content.documentTitle?.trim() ||
    input.templateFilename?.replace(/\.[^.]+$/, "");
  if (docTitle) {
    children.push(subtitleParagraph(docTitle));
  }

  const summaryRows = buildDealSummaryRows(input);
  if (summaryRows.length > 0) {
    children.push(summaryTable(summaryRows));
    children.push(
      new Paragraph({ spacing: { after: 200 }, children: [] })
    );
  }

  for (const segment of buildMergedExportSegments(input)) {
    children.push(...segmentToBlocks(segment));
  }

  const footerText = resolveExportFooterLabel(input);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: footerText,
                    font: BODY_FONT,
                    size: 18,
                    color: "666666",
                  }),
                  new TextRun({
                    text: "  ·  Page ",
                    font: BODY_FONT,
                    size: 18,
                    color: "666666",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: BODY_FONT,
                    size: 18,
                    color: "666666",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
