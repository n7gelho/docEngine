import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, documentChunks } from "@/lib/db/schema";
import { chunkDocument } from "@/lib/chunking/chunk-document";
import { classifyDocumentForIngestion } from "@/lib/extraction/classify-document";
import { extractLoiMetadata } from "@/lib/extraction/extract-metadata";
import { extractOlaMetadata } from "@/lib/extraction/extract-ola";
import { buildLoiExtractionText } from "@/lib/extraction/extraction-text";
import { ExtractionTraceCollector } from "@/lib/extraction/extraction-trace";
import { createExtractionContext } from "@/lib/extraction/pipeline/context";
import { mapExtractionToDocumentFields } from "@/lib/extraction/map-extraction-fields";
import { SCHEMA_VERSION } from "@/lib/profiles/schema-registry";
import { embedText, embedTexts, embeddingToSql } from "@/lib/embeddings/embed";
import { parseDocument } from "@/lib/parsing/parse-document";
import { readStoredFile } from "@/lib/storage/files";
import { autoLinkDocument } from "@/lib/deals/relations";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;

export async function processDocument(documentId: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });

  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    await db
      .update(documents)
      .set({ status: "processing", updatedAt: new Date(), errorMessage: null })
      .where(eq(documents.id, documentId));

    const buffer = await readStoredFile(doc.storageKey);
    const parsed = await parseDocument(buffer, doc.mimeType);
    const trace = new ExtractionTraceCollector();
    const pipelineCtx = createExtractionContext();

    const { dealType, documentType } = await classifyDocumentForIngestion(
      parsed,
      doc.filename,
      pipelineCtx,
      trace
    );

    let result;
    let model: string;
    let coverage;
    let extractionTrace;

    if (documentType === "OLA") {
      const olaOutcome = await extractOlaMetadata(
        parsed,
        { dealType, documentType: "OLA" },
        pipelineCtx,
        trace
      );
      result = olaOutcome.result;
      model = olaOutcome.model;
      coverage = olaOutcome.coverage;
      extractionTrace = olaOutcome.trace;
    } else {
      const loiText = buildLoiExtractionText(parsed);
      const loiOutcome = await extractLoiMetadata(
        loiText,
        { dealType, documentType: "LOI" },
        pipelineCtx,
        trace,
        doc.filename
      );
      result = loiOutcome.result;
      model = loiOutcome.model;
      coverage = loiOutcome.coverage;
      extractionTrace = loiOutcome.trace;
    }

    const mapped = mapExtractionToDocumentFields(
      result,
      coverage,
      extractionTrace
    );

    const chunks = chunkDocument(parsed);
    const chunkTexts = chunks.map((c) => {
      const prefix = c.heading ? `[${c.heading}] ` : "";
      return `${prefix}${c.text}`;
    });
    const chunkEmbeddings =
      chunkTexts.length > 0 ? await embedTexts(chunkTexts) : [];

    const summaryForDocEmbed = [
      mapped.dealType,
      mapped.documentType,
      mapped.lessor,
      mapped.lessee,
      mapped.seller,
      mapped.buyer,
      mapped.counterparty,
      mapped.aircraftType,
      mapped.msn,
      parsed.fullText.slice(0, 4000),
    ]
      .filter(Boolean)
      .join("\n");

    const documentEmbedding = await embedText(summaryForDocEmbed);

    await db
      .update(documents)
      .set({
        status: "ready",
        fullText: parsed.fullText,
        documentType: mapped.documentType,
        dealType: mapped.dealType,
        profileId: mapped.profileId,
        lessor: mapped.lessor,
        lessee: mapped.lessee,
        seller: mapped.seller,
        buyer: mapped.buyer,
        counterparty: mapped.counterparty,
        aircraftCount: mapped.aircraftCount,
        aircraftType: mapped.aircraftType,
        msn: mapped.msn,
        registration: mapped.registration,
        jurisdiction: mapped.jurisdiction,
        term: mapped.term,
        indicativeValue: mapped.indicativeValue,
        leaseType: mapped.leaseType,
        effectiveDate: mapped.effectiveDate,
        expiryDate: mapped.expiryDate,
        monthlyRent: mapped.monthlyRent,
        currency: mapped.currency,
        governingLaw: mapped.governingLaw,
        securityDeposit: mapped.securityDeposit,
        expectedDelivery: mapped.expectedDelivery,
        metadata: mapped.metadata,
        extractionModel: model,
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await sql`
      UPDATE documents
      SET document_embedding = ${embeddingToSql(documentEmbedding)}::vector
      WHERE id = ${documentId}
    `;

    await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, documentId));

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = chunkEmbeddings[i];

      const [inserted] = await db
        .insert(documentChunks)
        .values({
          documentId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          heading: chunk.heading,
          pageStart: chunk.pageStart,
        })
        .returning({ id: documentChunks.id });

      if (embedding) {
        await sql`
          UPDATE document_chunks
          SET embedding = ${embeddingToSql(embedding)}::vector
          WHERE id = ${inserted.id}
        `;
      }
    }

    await autoLinkDocument(documentId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown processing error";
    await db
      .update(documents)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    throw error;
  } finally {
    await sql.end();
  }
}
