import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { processDocument } from "@/lib/ingestion/process-document";
import { detectMimeType } from "@/lib/parsing/parse-document";
import { saveUploadedFile } from "@/lib/storage/files";

export type IngestUploadResult = {
  filename: string;
  documentId: string;
  duplicate: boolean;
  status: "accepted" | "duplicate" | "skipped" | "failed";
  message: string;
};

export function isAcceptedContractFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx");
}

export async function ingestUploadedFile(
  file: File
): Promise<IngestUploadResult> {
  if (!isAcceptedContractFilename(file.name)) {
    return {
      filename: file.name,
      documentId: "",
      duplicate: false,
      status: "skipped",
      message: "Skipped unsupported file type (PDF and DOCX only).",
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = detectMimeType(file.name, file.type);
    const { storageKey, sha256 } = await saveUploadedFile(buffer, file.name);

    const [existing] = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.sha256, sha256))
      .limit(1);

    if (existing) {
      if (existing.status === "failed" || existing.status === "pending") {
        processDocument(existing.id).catch((err) => {
          console.error("Background processing failed:", err);
        });
      }

      return {
        filename: file.name,
        documentId: existing.id,
        duplicate: true,
        status: "duplicate",
        message: "Document already uploaded; using existing record.",
      };
    }

    const [created] = await db
      .insert(documents)
      .values({
        filename: file.name,
        mimeType,
        storageKey,
        sha256,
        status: "pending",
      })
      .returning({ id: documents.id });

    processDocument(created.id).catch((err) => {
      console.error("Background processing failed:", err);
    });

    return {
      filename: file.name,
      documentId: created.id,
      duplicate: false,
      status: "accepted",
      message: "Upload accepted; processing started.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload document";
    return {
      filename: file.name,
      documentId: "",
      duplicate: false,
      status: "failed",
      message,
    };
  }
}

export type BatchIngestSummary = {
  total: number;
  accepted: number;
  duplicates: number;
  skipped: number;
  failed: number;
  results: IngestUploadResult[];
  message: string;
};

export function summarizeBatchResults(
  results: IngestUploadResult[]
): BatchIngestSummary {
  const accepted = results.filter((r) => r.status === "accepted").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const parts: string[] = [];
  if (accepted > 0) parts.push(`${accepted} uploaded`);
  if (duplicates > 0) parts.push(`${duplicates} duplicate`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);

  return {
    total: results.length,
    accepted,
    duplicates,
    skipped,
    failed,
    results,
    message:
      parts.length > 0
        ? parts.join(", ") + "."
        : "No supported PDF or DOCX files found.",
  };
}
