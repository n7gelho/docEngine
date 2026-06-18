import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { exportLoiAsDocx } from "@/lib/generation/export-loi-docx";
import { exportLoiAsPdf } from "@/lib/generation/export-loi-pdf";
import type { ExportDocumentInput } from "@/lib/generation/export-loi-shared";
import { safeExportBasename } from "@/lib/generation/export-loi-shared";
import { extractTemplatePreamble } from "@/lib/generation/loi-section-extract";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

export type LoiExportFormat = "txt" | "docx" | "pdf";

export type LoiExportResult = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

async function loadTemplateContext(
  content: LoiDraftContent
): Promise<Pick<ExportDocumentInput, "templatePreamble" | "templateFilename">> {
  if (!content.templateDocumentId) {
    return {
      templatePreamble: null,
      templateFilename: content.templateFilename ?? null,
    };
  }

  const [templateDoc] = await db
    .select({
      filename: documents.filename,
      fullText: documents.fullText,
    })
    .from(documents)
    .where(eq(documents.id, content.templateDocumentId))
    .limit(1);

  if (!templateDoc) {
    return {
      templatePreamble: null,
      templateFilename: content.templateFilename ?? null,
    };
  }

  return {
    templatePreamble: extractTemplatePreamble(templateDoc.fullText),
    templateFilename: templateDoc.filename ?? content.templateFilename ?? null,
  };
}

export async function exportLoiDraft(
  content: LoiDraftContent,
  format: LoiExportFormat,
  renderText: (content: LoiDraftContent) => string
): Promise<LoiExportResult> {
  const basename = safeExportBasename(content);
  const templateContext = await loadTemplateContext(content);
  const input: ExportDocumentInput = {
    content,
    ...templateContext,
  };

  switch (format) {
    case "docx": {
      const buffer = await exportLoiAsDocx(input);
      return {
        buffer,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: `${basename}.docx`,
      };
    }
    case "pdf": {
      const buffer = await exportLoiAsPdf(input);
      return {
        buffer,
        mimeType: "application/pdf",
        filename: `${basename}.pdf`,
      };
    }
    case "txt":
    default: {
      const text = renderText(content);
      return {
        buffer: Buffer.from(text, "utf-8"),
        mimeType: "text/plain; charset=utf-8",
        filename: `${basename}.txt`,
      };
    }
  }
}
