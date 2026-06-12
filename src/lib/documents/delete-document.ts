import { unlink } from "fs/promises";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dealDocuments, deals, documents } from "@/lib/db/schema";
import { deleteStoredFile } from "@/lib/storage/files";
import { getDocumentById } from "@/lib/search/documents";

export async function deleteDocument(documentId: string): Promise<void> {
  const document = await getDocumentById(documentId);
  if (!document) {
    throw new Error("Document not found");
  }

  const memberships = await db
    .select({ dealId: dealDocuments.dealId })
    .from(dealDocuments)
    .where(eq(dealDocuments.documentId, documentId));

  const dealIds = [...new Set(memberships.map((m) => m.dealId))];

  await db.delete(documents).where(eq(documents.id, documentId));

  try {
    await deleteStoredFile(document.storageKey);
  } catch {
    // File may already be missing; database record is still removed.
  }

  for (const dealId of dealIds) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dealDocuments)
      .where(eq(dealDocuments.dealId, dealId));

    if ((count ?? 0) === 0) {
      await db.delete(deals).where(eq(deals.id, dealId));
    }
  }
}
