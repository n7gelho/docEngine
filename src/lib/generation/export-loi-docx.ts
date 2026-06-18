import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import {
  fieldTextIncludesHeading,
  resolveBodyBlocksForExport,
  resolvePreambleForExport,
  splitTextIntoLines,
  splitTextIntoParagraphs,
} from "@/lib/generation/export-loi-shared";

const BODY_FONT = "Times New Roman";
const BODY_SIZE = 24;
const TITLE_SIZE = 28;

function bodyParagraph(
  text: string,
  options?: { bold?: boolean; spacingAfter?: number }
) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: options?.spacingAfter ?? 200, line: 276 },
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
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: true,
        underline: {},
      }),
    ],
  });
}

function blockToParagraphs(block: { label: string; text: string }): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  if (fieldTextIncludesHeading(block)) {
    const lines = splitTextIntoLines(block.text);
    if (lines.length > 0) {
      paragraphs.push(headingParagraph(lines[0]));
      for (const line of lines.slice(1)) {
        if (
          line.length < 90 &&
          /^[A-Z0-9][A-Za-z0-9\s\-/&().,'"]{2,}$/.test(line)
        ) {
          paragraphs.push(headingParagraph(line));
        } else {
          for (const chunk of splitTextIntoParagraphs(line)) {
            paragraphs.push(bodyParagraph(chunk));
          }
        }
      }
    }
    return paragraphs;
  }

  if (!/^section\s+\d+$/i.test(block.label.trim())) {
    paragraphs.push(headingParagraph(block.label.trim()));
  }

  for (const chunk of splitTextIntoParagraphs(block.text)) {
    paragraphs.push(bodyParagraph(chunk));
  }

  return paragraphs;
}

export async function exportLoiAsDocx(
  input: ExportDocumentInput
): Promise<Buffer> {
  const children: Paragraph[] = [];

  const preamble = resolvePreambleForExport(input);
  if (preamble) {
    for (const chunk of splitTextIntoParagraphs(preamble)) {
      children.push(bodyParagraph(chunk, { spacingAfter: 160 }));
    }
    children.push(
      new Paragraph({
        spacing: { after: 120 },
      })
    );
  } else if (input.content.documentTitle?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: input.content.documentTitle.trim(),
            font: BODY_FONT,
            size: TITLE_SIZE,
            bold: true,
          }),
        ],
      })
    );
  }

  for (const block of resolveBodyBlocksForExport(input)) {
    children.push(...blockToParagraphs(block));
  }

  const footerText = input.templateFilename
    ? `Template: ${input.templateFilename}`
    : "docEngine LOI draft";

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
