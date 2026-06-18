import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ReconcileSubstitution } from "@/lib/generation/proforma-reconcile";
import { findTextBoxesInPdf } from "@/lib/generation/pdf-text-positions";
import { sanitizeForPdfLib } from "@/lib/generation/export-loi-normalize";
import { filterInPlaceSubstitutions } from "@/lib/generation/export-loi-substitutions";

const PAD_X = 2;
const PAD_Y = 1;
const MIN_FONT_SIZE = 6.5;

function fitFontSize(
  text: string,
  font: PDFFont,
  targetWidth: number,
  baseSize: number
): number {
  let size = baseSize;
  while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(text, size) > targetWidth) {
    size -= 0.25;
  }
  return size;
}

function maskWidth(boxWidth: number, replacement: string, original: string): number {
  const growth = replacement.length / Math.max(original.length, 1);
  const extra = Math.min(72, Math.max(12, boxWidth * (growth - 1) * 0.65));
  return boxWidth + PAD_X * 2 + extra;
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
      const maskW = maskWidth(box.width, replacement, sub.from);
      const fontSize = fitFontSize(
        replacement,
        font,
        maskW - PAD_X * 2,
        Math.min(box.fontSize, 12)
      );

      page.drawRectangle({
        x: box.x - PAD_X,
        y: box.y - PAD_Y,
        width: maskW,
        height: box.height + PAD_Y * 2,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });

      page.drawText(replacement, {
        x: box.x,
        y: box.y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      applied++;
    }
  }

  if (applied === 0) {
    throw new Error("No template substitutions could be positioned in the PDF");
  }

  const bytes = await output.save();
  return Buffer.from(bytes);
}
