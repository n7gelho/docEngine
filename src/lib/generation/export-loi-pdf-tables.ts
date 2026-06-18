import { rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { ExportContentSegment } from "@/lib/generation/export-loi-shared";
import {
  measureWrappedCellHeight,
  pdfLineHeight,
  tableCellPadding,
  wrapTextToWidth,
} from "@/lib/generation/pdf-text-wrap";

const MIN_ROW_HEIGHT = 18;

function rowHeightForCells(
  row: string[],
  colCount: number,
  colWidth: number,
  font: PDFFont,
  fontSize: number
): number {
  const cellWidth = colWidth - tableCellPadding() * 2;
  let maxHeight = MIN_ROW_HEIGHT;
  for (let col = 0; col < colCount; col++) {
    const height = measureWrappedCellHeight(
      row[col] ?? "",
      font,
      fontSize,
      cellWidth
    );
    maxHeight = Math.max(maxHeight, height);
  }
  return maxHeight;
}

export function measureTableBlockHeight(
  rows: string[][],
  tableWidth: number,
  font: PDFFont,
  fontSize = 10
): number {
  if (rows.length === 0) return 0;
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = tableWidth / colCount;
  return rows.reduce(
    (sum, row) => sum + rowHeightForCells(row, colCount, colWidth, font, fontSize),
    0
  );
}

export function drawBorderedPdfTable(
  page: PDFPage,
  rows: string[][],
  origin: { x: number; y: number; width: number },
  font: PDFFont,
  options?: { fontSize?: number; headerRow?: boolean }
): number {
  const fontSize = options?.fontSize ?? 10;
  const lineHeight = pdfLineHeight(fontSize);
  const padding = tableCellPadding();
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = origin.width / colCount;
  let topY = origin.y;
  let totalHeight = 0;

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeightForCells(row, colCount, colWidth, font, fontSize);
    const cellY = topY - rowHeight;

    for (let col = 0; col < colCount; col++) {
      const x = origin.x + col * colWidth;
      const cellText = row[col] ?? "";
      const lines = wrapTextToWidth(
        cellText,
        font,
        fontSize,
        colWidth - padding * 2
      );

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

      let textY = cellY + rowHeight - padding - fontSize;
      for (const line of lines) {
        page.drawText(line, {
          x: x + padding,
          y: textY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      }
    }

    topY = cellY;
    totalHeight += rowHeight;
  });

  return totalHeight;
}

/** @deprecated Use measureTableBlockHeight with row/column content. */
export function tableBlockHeight(rowCount: number): number {
  return rowCount * MIN_ROW_HEIGHT;
}

export function isTableSegment(
  segment: ExportContentSegment
): segment is Extract<ExportContentSegment, { kind: "table" }> {
  return segment.kind === "table";
}
