import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ReconcileSubstitution } from "@/lib/generation/proforma-reconcile";
import { findTextBoxesInPdf } from "@/lib/generation/pdf-text-positions";
import { sanitizeForPdfLib } from "@/lib/generation/export-loi-normalize";
import { filterInPlaceSubstitutions } from "@/lib/generation/export-loi-substitutions";
import {
  pdfLineHeight,
  wrapTextToWidth,
} from "@/lib/generation/pdf-text-wrap";

const PAD_X = 2;
const PAD_Y = 2;
const MIN_FONT_SIZE = 6.5;
const PAGE_RIGHT_MARGIN = 36;
const MAX_EXTRA_MASK_WIDTH = 96;

function fitFontSizeForLines(
  lines: string[],
  font: PDFFont,
  targetWidth: number,
  baseSize: number
): number {
  let size = baseSize;
  while (size > MIN_FONT_SIZE) {
    const fits = lines.every(
      (line) => font.widthOfTextAtSize(line, size) <= targetWidth
    );
    if (fits) return size;
    size -= 0.25;
  }
  return MIN_FONT_SIZE;
}

function maskWidth(
  boxWidth: number,
  pageWidth: number,
  boxX: number,
  replacement: string,
  original: string
): number {
  const growth = replacement.length / Math.max(original.length, 1);
  const extra = Math.min(
    MAX_EXTRA_MASK_WIDTH,
    Math.max(12, boxWidth * (growth - 1) * 0.65)
  );
  const desired = boxWidth + PAD_X * 2 + extra;
  const maxAllowed = Math.max(boxWidth, pageWidth - boxX - PAGE_RIGHT_MARGIN);
  return Math.min(desired, maxAllowed);
}

function wrapReplacement(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines = wrapTextToWidth(text, font, fontSize, maxWidth);
  return lines.length > 0 ? lines : [text];
}

/**
 * Clone the template PDF and overlay proforma substitutions at discovered text positions.
 * Preserves original layout features (boxes, lines, tables) outside substituted regions.
 */
export async function exportLoiPdfSubstituteOnTemplate(
  templatePdfBuffer: Buffer,
  substitutions: ReconcileSubstitution[]
): Promise<Buffer> {
  const applicable = filterInPlaceSubstitutions(substitutions);
  if (applicable.length === 0) {
    return templatePdfBuffer;
  }

  const source = await PDFDocument.load(templatePdfBuffer);
  const output = await PDFDocument.create();
  const pages = source.getPages();
  const copied = await output.copyPages(source, pages.map((_, i) => i));
  copied.forEach((page) => output.addPage(page));

  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);

  let applied = 0;
  for (const sub of applicable) {
    const boxes = await findTextBoxesInPdf(templatePdfBuffer, sub.from);
    if (boxes.length === 0) continue;

    for (const box of boxes) {
      const page = output.getPages()[box.pageIndex];
      if (!page) continue;

      const replacement = sanitizeForPdfLib(sub.to);
      const font = /^\$|USD|rent|deposit/i.test(replacement) ? bold : regular;
      const pageWidth = page.getWidth();
      const textWidth = maskWidth(
        box.width,
        pageWidth,
        box.x,
        replacement,
        sub.from
      ) - PAD_X * 2;
      const baseSize = Math.min(box.fontSize, 12);

      let fontSize = baseSize;
      let lines = wrapReplacement(replacement, font, fontSize, textWidth);
      fontSize = fitFontSizeForLines(lines, font, textWidth, baseSize);
      lines = wrapReplacement(replacement, font, fontSize, textWidth);

      const lineHeight = pdfLineHeight(fontSize, 1);
      const textBlockHeight =
        (lines.length - 1) * lineHeight + fontSize + PAD_Y;
      const maskH = Math.max(box.height + PAD_Y * 2, textBlockHeight + PAD_Y);
      const maskW = textWidth + PAD_X * 2;

      page.drawRectangle({
        x: box.x - PAD_X,
        y: box.y - PAD_Y,
        width: maskW,
        height: maskH,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });

      let drawY = box.y + (lines.length - 1) * lineHeight;
      for (const line of lines) {
        page.drawText(line, {
          x: box.x,
          y: drawY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        drawY -= lineHeight;
      }
      applied++;
    }
  }

  if (applied === 0) {
    throw new Error("No template substitutions could be positioned in the PDF");
  }

  const bytes = await output.save();
  return Buffer.from(bytes);
}
