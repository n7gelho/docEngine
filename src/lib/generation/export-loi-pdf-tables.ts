import { rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";

const ROW_HEIGHT = 18;

export function drawBorderedPdfTable(
  page: PDFPage,
  rows: string[][],
  origin: { x: number; y: number; width: number },
  font: PDFFont,
  options?: { fontSize?: number; headerRow?: boolean }
): number {
  const fontSize = options?.fontSize ?? 10;
  const rowHeight = ROW_HEIGHT;
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = origin.width / colCount;
  let topY = origin.y;

  rows.forEach((row, rowIndex) => {
    const cellY = topY - rowHeight;
    for (let col = 0; col < colCount; col++) {
      const x = origin.x + col * colWidth;
      page.drawRectangle({
        x,
        y: cellY,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(0.78, 0.78, 0.78),
        borderWidth: 0.75,
        color:
          rowIndex === 0 && options?.headerRow
            ? rgb(0.95, 0.95, 0.95)
            : rgb(1, 1, 1),
      });
      page.drawText(row[col] ?? "", {
        x: x + 4,
        y: cellY + 4,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: colWidth - 8,
      });
    }
    topY = cellY;
  });

  return rows.length * rowHeight;
}

export function tableBlockHeight(rowCount: number): number {
  return rowCount * ROW_HEIGHT;
}

export function isTableSegment(
  segment: ExportContentSegment
): segment is Extract<ExportContentSegment, { kind: "table" }> {
  return segment.kind === "table";
}
