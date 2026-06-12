import mammoth from "mammoth";
import { normalizeContractText } from "@/lib/parsing/normalize-contract-text";

export type ParsedPage = {
  pageNumber: number;
  text: string;
};

export type ParsedDocument = {
  fullText: string;
  pages: ParsedPage[];
};

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  const fullText = normalizeContractText(result.value.trim());
  return {
    fullText,
    pages: [{ pageNumber: 1, text: fullText }],
  };
}

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  const fullText = normalizeContractText(data.text.trim());

  const pages: ParsedPage[] = [];
  if (data.numpages && data.numpages > 1) {
    const pageTexts = fullText.split(/\f/);
    pageTexts.forEach((text, index) => {
      if (text.trim()) {
        pages.push({ pageNumber: index + 1, text: text.trim() });
      }
    });
  }

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text: fullText });
  }

  return { fullText, pages };
}

export async function parseDocument(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocument> {
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return parseDocx(buffer);
  }

  if (mimeType === "application/pdf") {
    return parsePdf(buffer);
  }

  throw new Error(`Unsupported mime type: ${mimeType}`);
}

export function detectMimeType(filename: string, declaredType?: string): string {
  if (declaredType && declaredType !== "application/octet-stream") {
    return declaredType;
  }

  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";

  throw new Error("Could not determine file type. Upload PDF or DOCX only.");
}
