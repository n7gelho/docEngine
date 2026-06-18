import { eq } from "drizzle-orm";

import { db } from "@/lib/db";

import { documents } from "@/lib/db/schema";

import { exportLoiAsDocx } from "@/lib/generation/export-loi-docx";

import { exportLoiAsPdf } from "@/lib/generation/export-loi-pdf";

import type { ExportDocumentInput, TemplateDocContext } from "@/lib/generation/export-loi-shared";

import { safeExportBasename } from "@/lib/generation/export-loi-shared";

import {

  extractTemplateClosingBlock,

  extractTemplatePreamble,

} from "@/lib/generation/loi-section-extract";

import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

import { readStoredFile } from "@/lib/storage/files";

import {

  formatExportWarnings,

  sanitizeHttpHeaderValue,

  validateDraftForExport,

  type ExportValidationResult,

} from "@/lib/generation/export-validation";

import type { ProformaBrief } from "@/lib/retrieval/proforma-brief";

import { briefFromUnknownInput } from "@/lib/retrieval/proforma-brief";



export type LoiExportFormat = "txt" | "docx" | "pdf";



export type LoiExportOptions = {

  brief?: ProformaBrief | null;

};



export type LoiExportResult = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  validation: ExportValidationResult;
  pdfStrategy?: import("@/lib/generation/export-loi-pdf").LoiPdfExportStrategy;
};



async function loadTemplateContext(

  content: LoiDraftContent

): Promise<

  Pick<

    ExportDocumentInput,

    | "templatePreamble"

    | "templateFilename"

    | "templatePdfBuffer"

    | "templateMimeType"

    | "templateClosingBlock"

    | "templateFullText"

    | "templateDoc"

  >

> {

  const base = {

    templatePreamble: null as string | null,

    templateFilename: content.templateFilename ?? null,

    templatePdfBuffer: null as Buffer | null,

    templateMimeType: null as string | null,

    templateClosingBlock: null as string | null,

    templateFullText: null as string | null,

    templateDoc: null as TemplateDocContext | null,

  };



  if (!content.templateDocumentId) return base;



  const [templateDoc] = await db

    .select()

    .from(documents)

    .where(eq(documents.id, content.templateDocumentId))

    .limit(1);



  if (!templateDoc) return base;



  let templatePdfBuffer: Buffer | null = null;

  if (

    templateDoc.mimeType === "application/pdf" ||

    templateDoc.filename?.toLowerCase().endsWith(".pdf")

  ) {

    try {

      templatePdfBuffer = await readStoredFile(templateDoc.storageKey);

    } catch {

      templatePdfBuffer = null;

    }

  }



  return {

    templatePreamble: extractTemplatePreamble(templateDoc.fullText),

    templateFilename: templateDoc.filename ?? content.templateFilename ?? null,

    templatePdfBuffer,

    templateMimeType: templateDoc.mimeType,

    templateClosingBlock: extractTemplateClosingBlock(templateDoc.fullText),

    templateFullText: templateDoc.fullText ?? null,

    templateDoc: {

      fullText: templateDoc.fullText,

      dealType: templateDoc.dealType,

      metadata: templateDoc.metadata,

      lessor: templateDoc.lessor,

      lessee: templateDoc.lessee,

      seller: templateDoc.seller,

      buyer: templateDoc.buyer,

      aircraftType: templateDoc.aircraftType,

      term: templateDoc.term,

      leaseType: templateDoc.leaseType,

      monthlyRent: templateDoc.monthlyRent,

      currency: templateDoc.currency,

      securityDeposit: templateDoc.securityDeposit,

      expectedDelivery: templateDoc.expectedDelivery,

      aircraftCount: templateDoc.aircraftCount,

      governingLaw: templateDoc.governingLaw,

    },

  };

}



export async function exportLoiDraft(

  content: LoiDraftContent,

  format: LoiExportFormat,

  renderText: (content: LoiDraftContent) => string,

  options?: LoiExportOptions

): Promise<LoiExportResult> {

  const basename = safeExportBasename(content);

  const validation = validateDraftForExport(content);

  const templateContext = await loadTemplateContext(content);

  const input: ExportDocumentInput = {

    content,

    brief: options?.brief ?? null,

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

        validation,

      };

    }

    case "pdf": {
      const exportedPdf = await exportLoiAsPdf(input);
      return {
        buffer: exportedPdf.buffer,
        mimeType: "application/pdf",
        filename: `${basename}.pdf`,
        validation,
        pdfStrategy: exportedPdf.strategy,
      };
    }

    case "txt":

    default: {

      const text = renderText(content);

      return {

        buffer: Buffer.from(text, "utf-8"),

        mimeType: "text/plain; charset=utf-8",

        filename: `${basename}.txt`,

        validation,

      };

    }

  }

}



export { formatExportWarnings, sanitizeHttpHeaderValue, validateDraftForExport };


