import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dealDocuments,
  deals,
  documents,
  type Document,
} from "@/lib/db/schema";
import {
  AUTO_LINK_THRESHOLD,
  oppositeDocumentType,
  roleForDocumentType,
  scoreDocumentPair,
  shouldAutoLink,
  summarizeDealFields,
} from "@/lib/deals/matching";

export type LinkedDocumentSummary = {
  id: string;
  filename: string;
  documentType: string | null;
  dealType: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  msn: string | null;
  registration: string | null;
  effectiveDate: string | null;
  linkConfidence: number | null;
  linkSource: string;
};

export type DocumentDealRelations = {
  dealId: string | null;
  linkedLoi: LinkedDocumentSummary | null;
  linkedOla: LinkedDocumentSummary | null;
  suggestions: Array<LinkedDocumentSummary & { matchScore: number }>;
};

function toLinkedSummary(
  doc: Document,
  link: { linkConfidence: number | null; linkSource: string }
): LinkedDocumentSummary {
  return {
    id: doc.id,
    filename: doc.filename,
    documentType: doc.documentType,
    dealType: doc.dealType,
    lessor: doc.lessor,
    lessee: doc.lessee,
    seller: doc.seller,
    buyer: doc.buyer,
    msn: doc.msn,
    registration: doc.registration,
    effectiveDate: doc.effectiveDate,
    linkConfidence: link.linkConfidence,
    linkSource: link.linkSource,
  };
}

export async function getDocumentDealRelations(
  documentId: string
): Promise<DocumentDealRelations> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new Error("Document not found");
  }

  const [ownMembership] = await db
    .select()
    .from(dealDocuments)
    .where(eq(dealDocuments.documentId, documentId))
    .limit(1);

  let linkedLoi: LinkedDocumentSummary | null = null;
  let linkedOla: LinkedDocumentSummary | null = null;
  const dealId = ownMembership?.dealId ?? null;

  if (ownMembership) {
    const members = await db
      .select({
        link: dealDocuments,
        document: documents,
      })
      .from(dealDocuments)
      .innerJoin(documents, eq(dealDocuments.documentId, documents.id))
      .where(eq(dealDocuments.dealId, ownMembership.dealId));

    for (const member of members) {
      const summary = toLinkedSummary(member.document, {
        linkConfidence: member.link.linkConfidence,
        linkSource: member.link.linkSource,
      });
      if (member.link.role === "loi") linkedLoi = summary;
      if (member.link.role === "ola") linkedOla = summary;
    }
  }

  const suggestions = await findLinkSuggestions(doc, dealId);

  return {
    dealId,
    linkedLoi,
    linkedOla,
    suggestions,
  };
}

async function findLinkSuggestions(
  doc: Document,
  currentDealId: string | null
): Promise<Array<LinkedDocumentSummary & { matchScore: number }>> {
  const targetType = oppositeDocumentType(doc.documentType);
  const ownRole = roleForDocumentType(doc.documentType);
  if (!targetType || !ownRole) return [];

  const candidates = await db
    .select({
      document: documents,
      dealId: dealDocuments.dealId,
      role: dealDocuments.role,
    })
    .from(documents)
    .leftJoin(dealDocuments, eq(dealDocuments.documentId, documents.id))
    .where(
      and(
        eq(documents.status, "ready"),
        eq(documents.documentType, targetType),
        doc.dealType
          ? eq(documents.dealType, doc.dealType)
          : sql`TRUE`,
        ne(documents.id, doc.id)
      )
    );

  const suggestions: Array<LinkedDocumentSummary & { matchScore: number }> = [];

  for (const candidate of candidates) {
    if (candidate.dealId) {
      if (currentDealId && candidate.dealId === currentDealId) continue;
      const existingSameRole = await getDealMemberByRole(
        candidate.dealId,
        ownRole
      );
      if (existingSameRole && existingSameRole.documentId !== doc.id) {
        continue;
      }
    }

    const matchScore = scoreDocumentPair(doc, candidate.document);
    if (matchScore < AUTO_LINK_THRESHOLD) continue;

    suggestions.push({
      ...toLinkedSummary(candidate.document, {
        linkConfidence: matchScore,
        linkSource: "suggested",
      }),
      matchScore,
    });
  }

  return suggestions
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);
}

async function getDealMembership(documentId: string) {
  const [membership] = await db
    .select()
    .from(dealDocuments)
    .where(eq(dealDocuments.documentId, documentId))
    .limit(1);
  return membership ?? null;
}

async function getDealMemberByRole(dealId: string, role: "loi" | "ola") {
  const [member] = await db
    .select()
    .from(dealDocuments)
    .where(and(eq(dealDocuments.dealId, dealId), eq(dealDocuments.role, role)))
    .limit(1);
  return member ?? null;
}

export async function linkDocumentsToDeal(
  sourceDocumentId: string,
  targetDocumentId: string,
  options: {
    confidence?: number;
    source?: "auto" | "manual";
  } = {}
): Promise<{ dealId: string }> {
  if (sourceDocumentId === targetDocumentId) {
    throw new Error("Cannot link a document to itself");
  }

  const [[sourceDoc], [targetDoc]] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, sourceDocumentId)).limit(1),
    db.select().from(documents).where(eq(documents.id, targetDocumentId)).limit(1),
  ]);

  if (!sourceDoc || !targetDoc) {
    throw new Error("One or both documents were not found");
  }

  const sourceRole = roleForDocumentType(sourceDoc.documentType);
  const targetRole = roleForDocumentType(targetDoc.documentType);

  if (!sourceRole || !targetRole || sourceRole === targetRole) {
    throw new Error("Documents must be one LOI and one OLA to link");
  }

  if (
    sourceDoc.dealType &&
    targetDoc.dealType &&
    sourceDoc.dealType !== targetDoc.dealType
  ) {
    throw new Error("Documents must belong to the same deal type (Purchase or Lease)");
  }

  const confidence =
    options.confidence ?? scoreDocumentPair(sourceDoc, targetDoc);
  const linkSource = options.source ?? "manual";

  const sourceMembership = await getDealMembership(sourceDocumentId);
  const targetMembership = await getDealMembership(targetDocumentId);

  if (
    sourceMembership &&
    targetMembership &&
    sourceMembership.dealId !== targetMembership.dealId
  ) {
    throw new Error("Documents belong to different deals; unlink one first");
  }

  let dealId = sourceMembership?.dealId ?? targetMembership?.dealId ?? null;

  if (dealId) {
    const existingSourceRole = await getDealMemberByRole(dealId, sourceRole);
    const existingTargetRole = await getDealMemberByRole(dealId, targetRole);

    if (
      existingSourceRole &&
      existingSourceRole.documentId !== sourceDocumentId
    ) {
      throw new Error(`This deal already has a linked ${sourceRole.toUpperCase()}`);
    }
    if (
      existingTargetRole &&
      existingTargetRole.documentId !== targetDocumentId
    ) {
      throw new Error(`This deal already has a linked ${targetRole.toUpperCase()}`);
    }
  } else {
    const [createdDeal] = await db
      .insert(deals)
      .values({
        ...summarizeDealFields(sourceDoc, targetDoc),
        updatedAt: new Date(),
      })
      .returning({ id: deals.id });
    dealId = createdDeal.id;
  }

  await upsertDealDocument(dealId, sourceDocumentId, sourceRole, confidence, linkSource);
  await upsertDealDocument(dealId, targetDocumentId, targetRole, confidence, linkSource);

  await db
    .update(deals)
    .set({
      ...summarizeDealFields(sourceDoc, targetDoc),
      updatedAt: new Date(),
    })
    .where(eq(deals.id, dealId));

  return { dealId };
}

async function upsertDealDocument(
  dealId: string,
  documentId: string,
  role: "loi" | "ola",
  confidence: number,
  linkSource: "auto" | "manual"
) {
  const existing = await getDealMembership(documentId);
  if (existing) {
    if (existing.dealId !== dealId || existing.role !== role) {
      throw new Error("Document is already linked to another deal");
    }
    await db
      .update(dealDocuments)
      .set({
        linkConfidence: confidence,
        linkSource,
      })
      .where(eq(dealDocuments.documentId, documentId));
    return;
  }

  await db.insert(dealDocuments).values({
    dealId,
    documentId,
    role,
    linkConfidence: confidence,
    linkSource,
  });
}

export async function unlinkDocumentFromDeal(documentId: string): Promise<void> {
  const membership = await getDealMembership(documentId);
  if (!membership) return;

  const dealId = membership.dealId;
  await db
    .delete(dealDocuments)
    .where(eq(dealDocuments.documentId, documentId));

  const remaining = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dealDocuments)
    .where(eq(dealDocuments.dealId, dealId));

  if ((remaining[0]?.count ?? 0) === 0) {
    await db.delete(deals).where(eq(deals.id, dealId));
  }
}

export async function autoLinkDocument(documentId: string): Promise<{
  linked: boolean;
  dealId?: string;
  matchedDocumentId?: string;
  confidence?: number;
}> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc || doc.status !== "ready") {
    return { linked: false };
  }

  const targetType = oppositeDocumentType(doc.documentType);
  const ownRole = roleForDocumentType(doc.documentType);
  if (!targetType || !ownRole) {
    return { linked: false };
  }

  const ownMembership = await getDealMembership(documentId);
  if (ownMembership) {
    const oppositeRole = ownRole === "loi" ? "ola" : "loi";
    const oppositeMember = await getDealMemberByRole(
      ownMembership.dealId,
      oppositeRole
    );
    if (oppositeMember) {
      return { linked: false, dealId: ownMembership.dealId };
    }
  }

  const candidates = await db
    .select({
      document: documents,
      dealId: dealDocuments.dealId,
      role: dealDocuments.role,
    })
    .from(documents)
    .leftJoin(dealDocuments, eq(dealDocuments.documentId, documents.id))
    .where(
      and(
        eq(documents.status, "ready"),
        eq(documents.documentType, targetType),
        doc.dealType
          ? eq(documents.dealType, doc.dealType)
          : sql`TRUE`,
        ne(documents.id, documentId)
      )
    );

  let best: { document: Document; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.dealId && candidate.role === roleForDocumentType(targetType)) {
      const existingOpposite = await getDealMemberByRole(
        candidate.dealId,
        ownRole
      );
      if (existingOpposite && existingOpposite.documentId !== documentId) {
        continue;
      }
    }

    const score = scoreDocumentPair(doc, candidate.document);
    if (!shouldAutoLink(score, doc, candidate.document)) continue;

    if (!best || score > best.score) {
      best = {
        document: candidate.document,
        score,
      };
    }
  }

  if (!best) {
    return { linked: false };
  }

  const result = await linkDocumentsToDeal(documentId, best.document.id, {
    confidence: best.score,
    source: "auto",
  });

  return {
    linked: true,
    dealId: result.dealId,
    matchedDocumentId: best.document.id,
    confidence: best.score,
  };
}
