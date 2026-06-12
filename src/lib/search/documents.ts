import {
  and,
  eq,
  ilike,
  gte,
  lte,
  sql,
  desc,
  inArray,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  embedText,
  embeddingToSql,
  cosineSimilarity,
} from "@/lib/embeddings/embed";
import postgres from "postgres";

export type DocumentFilters = {
  documentType?: string;
  dealType?: string;
  lessor?: string;
  lessee?: string;
  seller?: string;
  buyer?: string;
  aircraftType?: string;
  msn?: string;
  registration?: string;
  leaseType?: string;
  governingLaw?: string;
  currency?: string;
  aircraftCount?: number;
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
  expiryDateFrom?: string;
  expiryDateTo?: string;
  monthlyRentMin?: number;
  monthlyRentMax?: number;
  status?: string;
  ids?: string[];
  q?: string;
  counterparty?: string;
  term?: string;
  jurisdiction?: string;
  indicativeValue?: string;
  olaSections?: Record<string, string>;
  limit?: number;
  offset?: number;
};

function olaSectionFilterCondition(
  sectionId: string,
  query: string
): SQL {
  const pattern = `%${query}%`;
  const prefix = `${sectionId}.%`;
  return sql`(
    ${documents.documentType} = 'OLA'
    AND EXISTS (
      SELECT 1 FROM jsonb_each(${documents.metadata}) AS kv(key, value)
      WHERE kv.key LIKE ${prefix}
        AND kv.value->>'value' ILIKE ${pattern}
    )
  )`;
}

export async function listDocuments(filters: DocumentFilters = {}) {
  const conditions: SQL[] = [];

  if (filters.documentType) {
    conditions.push(eq(documents.documentType, filters.documentType));
  }
  if (filters.dealType) {
    conditions.push(eq(documents.dealType, filters.dealType));
  }
  if (filters.status) {
    conditions.push(eq(documents.status, filters.status));
  }
  if (filters.ids && filters.ids.length > 0) {
    conditions.push(inArray(documents.id, filters.ids));
  }
  if (filters.lessor) {
    conditions.push(ilike(documents.lessor, `%${filters.lessor}%`));
  }
  if (filters.lessee) {
    conditions.push(ilike(documents.lessee, `%${filters.lessee}%`));
  }
  if (filters.seller) {
    conditions.push(ilike(documents.seller, `%${filters.seller}%`));
  }
  if (filters.buyer) {
    conditions.push(ilike(documents.buyer, `%${filters.buyer}%`));
  }
  if (filters.aircraftType) {
    conditions.push(ilike(documents.aircraftType, `%${filters.aircraftType}%`));
  }
  if (filters.msn) {
    conditions.push(ilike(documents.msn, `%${filters.msn}%`));
  }
  if (filters.registration) {
    conditions.push(ilike(documents.registration, `%${filters.registration}%`));
  }
  if (filters.leaseType) {
    conditions.push(ilike(documents.leaseType, `%${filters.leaseType}%`));
  }
  if (filters.governingLaw) {
    conditions.push(ilike(documents.governingLaw, `%${filters.governingLaw}%`));
  }
  if (filters.counterparty) {
    conditions.push(ilike(documents.counterparty, `%${filters.counterparty}%`));
  }
  if (filters.term) {
    conditions.push(ilike(documents.term, `%${filters.term}%`));
  }
  if (filters.jurisdiction) {
    conditions.push(ilike(documents.jurisdiction, `%${filters.jurisdiction}%`));
  }
  if (filters.indicativeValue) {
    conditions.push(
      ilike(documents.indicativeValue, `%${filters.indicativeValue}%`)
    );
  }
  if (filters.olaSections) {
    for (const [sectionId, query] of Object.entries(filters.olaSections)) {
      if (query.trim()) {
        conditions.push(olaSectionFilterCondition(sectionId, query.trim()));
      }
    }
  }
  if (filters.aircraftCount !== undefined) {
    conditions.push(eq(documents.aircraftCount, filters.aircraftCount));
  }
  if (filters.currency) {
    conditions.push(eq(documents.currency, filters.currency));
  }
  if (filters.effectiveDateFrom) {
    conditions.push(gte(documents.effectiveDate, filters.effectiveDateFrom));
  }
  if (filters.effectiveDateTo) {
    conditions.push(lte(documents.effectiveDate, filters.effectiveDateTo));
  }
  if (filters.expiryDateFrom) {
    conditions.push(gte(documents.expiryDate, filters.expiryDateFrom));
  }
  if (filters.expiryDateTo) {
    conditions.push(lte(documents.expiryDate, filters.expiryDateTo));
  }
  if (filters.monthlyRentMin !== undefined) {
    conditions.push(gte(documents.monthlyRent, filters.monthlyRentMin));
  }
  if (filters.monthlyRentMax !== undefined) {
    conditions.push(lte(documents.monthlyRent, filters.monthlyRentMax));
  }
  if (filters.q) {
    conditions.push(
      sql`${documents.filename} ILIKE ${"%" + filters.q + "%"}`
    );
  }

  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      status: documents.status,
      documentType: documents.documentType,
      dealType: documents.dealType,
      profileId: documents.profileId,
      lessor: documents.lessor,
      lessee: documents.lessee,
      seller: documents.seller,
      buyer: documents.buyer,
      counterparty: documents.counterparty,
      aircraftCount: documents.aircraftCount,
      aircraftType: documents.aircraftType,
      msn: documents.msn,
      registration: documents.registration,
      jurisdiction: documents.jurisdiction,
      term: documents.term,
      indicativeValue: documents.indicativeValue,
      leaseType: documents.leaseType,
      effectiveDate: documents.effectiveDate,
      expiryDate: documents.expiryDate,
      monthlyRent: documents.monthlyRent,
      currency: documents.currency,
      governingLaw: documents.governingLaw,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(whereClause)
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(whereClause);

  return { documents: rows, total: count, limit, offset };
}

export type SemanticSearchOptions = {
  query: string;
  limit?: number;
  documentType?: string;
  filters?: DocumentFilters;
};

export type SearchHit = {
  documentId: string;
  filename: string;
  documentType: string | null;
  lessor: string | null;
  lessee: string | null;
  score: number;
  snippet: string;
  heading: string | null;
  pageStart: number | null;
};

export async function semanticSearch(
  options: SemanticSearchOptions
): Promise<SearchHit[]> {
  const sqlClient = postgres(process.env.DATABASE_URL!, { max: 1 });
  const limit = Math.min(options.limit ?? 10, 50);
  const queryEmbedding = await embedText(options.query);
  const vectorSql = embeddingToSql(queryEmbedding);

  try {
    const typeFilter = options.documentType
      ? sqlClient`AND d.document_type = ${options.documentType}`
      : sqlClient``;

    const rows = await sqlClient`
      SELECT
        d.id AS document_id,
        d.filename,
        d.document_type,
        d.lessor,
        d.lessee,
        c.text AS snippet,
        c.heading,
        c.page_start,
        1 - (c.embedding <=> ${vectorSql}::vector) AS score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'ready'
        AND c.embedding IS NOT NULL
        ${typeFilter}
      ORDER BY c.embedding <=> ${vectorSql}::vector
      LIMIT ${limit * 5}
    `;

    const byDocument = new Map<string, SearchHit>();

    for (const row of rows) {
      const existing = byDocument.get(row.document_id);
      if (!existing || row.score > existing.score) {
        byDocument.set(row.document_id, {
          documentId: row.document_id,
          filename: row.filename,
          documentType: row.document_type,
          lessor: row.lessor,
          lessee: row.lessee,
          score: Number(row.score),
          snippet: row.snippet?.slice(0, 400) ?? "",
          heading: row.heading,
          pageStart: row.page_start,
        });
      }
    }

    return Array.from(byDocument.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } finally {
    await sqlClient.end();
  }
}

export type SimilarDocumentOptions = {
  documentId: string;
  limit?: number;
  documentType?: string;
};

export async function findSimilarDocuments(
  options: SimilarDocumentOptions
): Promise<SearchHit[]> {
  const sqlClient = postgres(process.env.DATABASE_URL!, { max: 1 });
  const limit = Math.min(options.limit ?? 10, 50);

  try {
    const [source] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, options.documentId))
      .limit(1);

    if (!source) {
      throw new Error("Source document not found");
    }

    if (source.status !== "ready") {
      throw new Error("Source document is not ready for similarity search");
    }

    const sourceRows = await sqlClient`
      SELECT embedding::text AS embedding
      FROM documents
      WHERE id = ${options.documentId}
        AND document_embedding IS NOT NULL
    `;

    if (sourceRows.length > 0 && sourceRows[0].embedding) {
      const vectorSql = sourceRows[0].embedding.replace(/^\(/, "[").replace(/\)$/, "]");

      const typeFilter = options.documentType
        ? sqlClient`AND d.document_type = ${options.documentType}`
        : sqlClient``;

      const rows = await sqlClient`
        SELECT
          d.id AS document_id,
          d.filename,
          d.document_type,
          d.lessor,
          d.lessee,
          1 - (d.document_embedding <=> ${vectorSql}::vector) AS score
        FROM documents d
        WHERE d.status = 'ready'
          AND d.document_embedding IS NOT NULL
          AND d.id != ${options.documentId}
          ${typeFilter}
        ORDER BY d.document_embedding <=> ${vectorSql}::vector
        LIMIT ${limit}
      `;

      return rows.map((row) => ({
        documentId: row.document_id,
        filename: row.filename,
        documentType: row.document_type,
        lessor: row.lessor,
        lessee: row.lessee,
        score: Number(row.score),
        snippet: "",
        heading: null,
        pageStart: null,
      }));
    }

    const chunkRows = await sqlClient`
      SELECT text, embedding::text AS embedding
      FROM document_chunks
      WHERE document_id = ${options.documentId}
        AND embedding IS NOT NULL
      LIMIT 20
    `;

    if (chunkRows.length === 0) {
      return [];
    }

    const candidateRows = await sqlClient`
      SELECT
        d.id AS document_id,
        d.filename,
        d.document_type,
        d.lessor,
        d.lessee,
        c.text AS snippet,
        c.heading,
        c.page_start,
        c.embedding::text AS embedding
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'ready'
        AND d.id != ${options.documentId}
        AND c.embedding IS NOT NULL
    `;

    const scores = new Map<string, SearchHit>();

    for (const sourceChunk of chunkRows) {
      const sourceVec = parseVector(sourceChunk.embedding);
      for (const candidate of candidateRows) {
        const candidateVec = parseVector(candidate.embedding);
        const score = cosineSimilarity(sourceVec, candidateVec);
        const existing = scores.get(candidate.document_id);
        if (!existing || score > existing.score) {
          scores.set(candidate.document_id, {
            documentId: candidate.document_id,
            filename: candidate.filename,
            documentType: candidate.document_type,
            lessor: candidate.lessor,
            lessee: candidate.lessee,
            score,
            snippet: candidate.snippet?.slice(0, 400) ?? "",
            heading: candidate.heading,
            pageStart: candidate.page_start,
          });
        }
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } finally {
    await sqlClient.end();
  }
}

function parseVector(raw: string): number[] {
  const normalized = raw.replace(/^\(/, "[").replace(/\)$/, "]");
  return JSON.parse(normalized);
}

export async function getDocumentById(id: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return doc ?? null;
}
