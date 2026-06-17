import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  computeCombinedScore,
} from "@/lib/retrieval/precedent-combined-score";
import {
  scoreDocumentAgainstBrief,
  type PrecedentScore,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import { computeTemplateFitness } from "@/lib/retrieval/template-fitness";

export type PrecedentHit = {
  documentId: string;
  filename: string;
  documentType: string | null;
  dealType: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  aircraftType: string | null;
  term: string | null;
  leaseType: string | null;
  monthlyRent: number | null;
  currency: string | null;
  matchScore: number;
  templateFitness: number;
  combinedScore: number;
  matchedParameters: number;
  matchedWeight: number;
  comparedParameters: number;
  comparedWeight: number;
  parameterMatches: PrecedentScore["matches"];
};

export type FindPrecedentsOptions = {
  brief: ProformaBrief;
  limit?: number;
  dealType?: string;
  documentType?: string;
};

export async function findPrecedentDocuments(
  options: FindPrecedentsOptions
): Promise<PrecedentHit[]> {
  const limit = Math.min(options.limit ?? 3, 20);

  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      documentType: documents.documentType,
      dealType: documents.dealType,
      lessor: documents.lessor,
      lessee: documents.lessee,
      seller: documents.seller,
      buyer: documents.buyer,
      aircraftType: documents.aircraftType,
      term: documents.term,
      leaseType: documents.leaseType,
      monthlyRent: documents.monthlyRent,
      currency: documents.currency,
      governingLaw: documents.governingLaw,
      effectiveDate: documents.effectiveDate,
      fullText: documents.fullText,
      metadata: documents.metadata,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.status, "ready"));

  const scored = rows
    .map((row) => {
      if (
        options.dealType &&
        row.dealType &&
        row.dealType !== options.dealType
      ) {
        return null;
      }
      if (
        options.documentType &&
        row.documentType &&
        row.documentType !== options.documentType
      ) {
        return null;
      }

      const precedentScore = scoreDocumentAgainstBrief(options.brief, row.metadata);
      if (precedentScore.comparedParameters === 0) return null;

      const templateFitness = computeTemplateFitness(
        {
          documentType: row.documentType,
          dealType: row.dealType,
          governingLaw: row.governingLaw,
          effectiveDate: row.effectiveDate,
          createdAt: row.createdAt,
          metadata: row.metadata,
          fullText: row.fullText,
        },
        options.brief,
        { briefDealType: options.dealType }
      ).score;

      const combinedScore = computeCombinedScore(
        precedentScore.score,
        templateFitness
      );

      return {
        documentId: row.id,
        filename: row.filename,
        documentType: row.documentType,
        dealType: row.dealType,
        lessor: row.lessor,
        lessee: row.lessee,
        seller: row.seller,
        buyer: row.buyer,
        aircraftType: row.aircraftType,
        term: row.term,
        leaseType: row.leaseType,
        monthlyRent: row.monthlyRent,
        currency: row.currency,
        matchScore: precedentScore.score,
        templateFitness,
        combinedScore,
        matchedParameters: precedentScore.matchedParameters,
        matchedWeight: precedentScore.matchedWeight,
        comparedParameters: precedentScore.comparedParameters,
        comparedWeight: precedentScore.comparedWeight,
        parameterMatches: precedentScore.matches,
      } satisfies PrecedentHit;
    })
    .filter((row): row is PrecedentHit => row !== null)
    .sort((a, b) => {
      if (b.combinedScore !== a.combinedScore) {
        return b.combinedScore - a.combinedScore;
      }
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (b.templateFitness !== a.templateFitness) {
        return b.templateFitness - a.templateFitness;
      }
      if (b.matchedWeight !== a.matchedWeight) {
        return b.matchedWeight - a.matchedWeight;
      }
      if (b.matchedParameters !== a.matchedParameters) {
        return b.matchedParameters - a.matchedParameters;
      }
      return b.comparedParameters - a.comparedParameters;
    })
    .slice(0, limit);

  return scored;
}
