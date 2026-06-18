import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import {
  fieldTextIncludesHeading,
  resolveBodyBlocksForExport,
  resolvePreambleForExport,
  splitTextIntoLines,
  splitTextIntoParagraphs,
} from "@/lib/generation/export-loi-shared";

const MARGIN = 72;
const BODY_SIZE = 11;
const TITLE_SIZE = 13;

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

function renderBlock(
  doc: PDFKit.PDFDocument,
  block: { label: string; text: string }
) {
  if (fieldTextIncludesHeading(block)) {
    const lines = splitTextIntoLines(block.text);
    if (lines.length === 0) return;
    doc.moveDown(0.4);
    renderParagraph(doc, lines[0], { bold: true });
    for (const line of lines.slice(1)) {
      if (
        line.length < 90 &&
        /^[A-Z0-9][A-Za-z0-9\s\-/&().,'"]{2,}$/.test(line)
      ) {
        doc.moveDown(0.25);
        renderParagraph(doc, line, { bold: true });
      } else {
        doc.moveDown(0.15);
        for (const chunk of splitTextIntoParagraphs(line)) {
          renderParagraph(doc, chunk);
        }
      }
    }
    return;
  }

  if (!/^section\s+\d+$/i.test(block.label.trim())) {
    doc.moveDown(0.4);
    renderParagraph(doc, block.label.trim(), { bold: true });
  }

  for (const chunk of splitTextIntoParagraphs(block.text)) {
    doc.moveDown(0.15);
    renderParagraph(doc, chunk);
  }
}

export async function exportLoiAsPdf(
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

    const preamble = resolvePreambleForExport(input);
    if (preamble) {
      for (const chunk of splitTextIntoParagraphs(preamble)) {
        renderParagraph(doc, chunk);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.5);
    } else if (input.content.documentTitle?.trim()) {
      doc
        .font("Times-Bold")
        .fontSize(TITLE_SIZE)
        .text(input.content.documentTitle.trim(), { align: "center" });
      doc.moveDown(1);
    }

    for (const block of resolveBodyBlocksForExport(input)) {
      renderBlock(doc, block);
    }

    const footerLabel = input.templateFilename
      ? `Template: ${input.templateFilename}`
      : "docEngine LOI draft";

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
