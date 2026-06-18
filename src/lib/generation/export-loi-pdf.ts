import PDFDocument from "pdfkit";

import type PDFKit from "pdfkit";

import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";

import {
  buildMergedExportSegments,
  resolveExportFooterLabel,
  type ExportContentSegment,
} from "@/lib/generation/export-loi-shared";
import { exportLoiPdfHouse } from "@/lib/generation/export-loi-pdf-house";



const MARGIN = 72;

const BODY_SIZE = 11;

const TABLE_CELL_PADDING = 4;



function renderParagraph(

  doc: PDFKit.PDFDocument,

  text: string,

  options?: { bold?: boolean; align?: "left" | "center" | "justify" }

) {

  doc

    .font(options?.bold ? "Times-Bold" : "Times-Roman")

    .fontSize(BODY_SIZE)

    .text(text, {

      align: options?.align ?? "justify",

      lineGap: 4,

    });

}



function renderTable(
  doc: PDFKit.PDFDocument,
  rows: string[][]
) {
  if (rows.length === 0) return;

  const colCount = Math.max(...rows.map((r) => r.length));
  const tableWidth = doc.page.width - MARGIN * 2;
  const colWidth = tableWidth / colCount;
  const startX = MARGIN;
  const cellInnerWidth = colWidth - TABLE_CELL_PADDING * 2;
  let y = doc.y + 8;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const headerFont = rowIndex === 0 ? "Times-Bold" : "Times-Roman";
    doc.font(headerFont).fontSize(BODY_SIZE);

    let rowHeight = BODY_SIZE + TABLE_CELL_PADDING * 2 + 6;
    for (let col = 0; col < colCount; col++) {
      const cell = row[col] ?? "";
      const cellHeight =
        doc.heightOfString(cell, {
          width: cellInnerWidth,
          lineGap: 2,
        }) +
        TABLE_CELL_PADDING * 2 +
        4;
      rowHeight = Math.max(rowHeight, cellHeight);
    }

    if (y + rowHeight > doc.page.height - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    doc
      .rect(startX, y, tableWidth, rowHeight)
      .lineWidth(0.75)
      .strokeColor("#BBBBBB")
      .stroke();

    for (let col = 0; col < colCount; col++) {
      const x = startX + col * colWidth;
      if (col > 0) {
        doc
          .moveTo(x, y)
          .lineTo(x, y + rowHeight)
          .strokeColor("#BBBBBB")
          .lineWidth(0.75)
          .stroke();
      }
      if (rowIndex === 0) {
        doc.rect(x, y, colWidth, rowHeight).fill("#F2F2F2");
      }
      doc
        .font(rowIndex === 0 ? "Times-Bold" : "Times-Roman")
        .fontSize(BODY_SIZE)
        .fillColor("#000000")
        .text(row[col] ?? "", x + TABLE_CELL_PADDING, y + TABLE_CELL_PADDING, {
          width: cellInnerWidth,
          lineGap: 2,
        });
    }

    y += rowHeight;
  }

  doc.y = y;
  doc.strokeColor("#000000");
}



function renderSegment(doc: PDFKit.PDFDocument, segment: ExportContentSegment) {

  switch (segment.kind) {

    case "heading":

      doc.moveDown(0.4);

      renderParagraph(doc, segment.text, { bold: true });

      break;

    case "subheading":

      doc.moveDown(0.25);

      renderParagraph(doc, segment.text, { bold: true });

      break;

    case "paragraph":

      doc.moveDown(0.15);

      renderParagraph(doc, segment.text);

      break;

    case "table":

      renderTable(doc, segment.rows);

      break;

  }

}



async function exportLoiAsPdfKit(
  input: ExportDocumentInput
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: {
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
      },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const segment of buildMergedExportSegments(input)) {
      renderSegment(doc, segment);
    }



    const footerLabel = resolveExportFooterLabel(input);



    const pages = doc.bufferedPageRange();

    for (let i = 0; i < pages.count; i++) {

      doc.switchToPage(i);

      doc

        .font("Times-Roman")

        .fontSize(9)

        .fillColor("#666666")

        .text(

          `${footerLabel}  ·  Page ${i + 1} of ${pages.count}`,

          MARGIN,

          doc.page.height - 50,

          {

            align: "center",

            width: doc.page.width - MARGIN * 2,

          }

        );

    }



    doc.fillColor("#000000");

    doc.end();

  });

}



export type LoiPdfExportStrategy = "house" | "regenerate";

export type LoiPdfExportResult = {
  buffer: Buffer;
  strategy: LoiPdfExportStrategy;
};

export async function exportLoiAsPdf(
  input: ExportDocumentInput
): Promise<LoiPdfExportResult> {
  try {
    const buffer = await exportLoiPdfHouse(input);
    return { buffer, strategy: "house" };
  } catch (error) {
    console.warn(
      "[export-loi-pdf] house template failed:",
      error instanceof Error ? error.message : error
    );
  }

  const buffer = await exportLoiAsPdfKit(input);
  return { buffer, strategy: "regenerate" };
}


