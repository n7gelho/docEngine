import type { DocumentMetadataJson } from "@/lib/db/schema";
import {
  DEAL_PARAMETER_KEYS,
  type DealParameterKey,
} from "@/lib/extraction/deal-parameters";
import {
  parameterValueFromMetadata,
  scoreParameterPair,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";

export type TemplateFitnessInput = {
  documentType: string | null;
  dealType: string | null;
  governingLaw: string | null;
  effectiveDate: string | null;
  createdAt: Date;
  metadata: DocumentMetadataJson | null | undefined;
  fullText: string | null;
};

export type TemplateFitnessBreakdown = {
  governingLaw: number;
  recency: number;
  extractionCoverage: number;
  documentFit: number;
};

export type TemplateFitnessResult = {
  score: number;
  breakdown: TemplateFitnessBreakdown;
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenOverlap(a: string, b: string): number {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const leftTokens = new Set(left.split(" ").filter((t) => t.length > 1));
  const rightTokens = new Set(right.split(" ").filter((t) => t.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function scoreRecency(effectiveDate: string | null, createdAt: Date): number {
  const year = parseYear(effectiveDate) ?? createdAt.getFullYear();
  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - year);
  if (age <= 1) return 1;
  if (age <= 3) return 0.85;
  if (age <= 5) return 0.65;
  if (age <= 8) return 0.45;
  return 0.25;
}

function scoreExtractionCoverage(
  metadata: DocumentMetadataJson | null | undefined
): number {
  if (!metadata) return 0;

  let filled = 0;
  let confidenceSum = 0;

  for (const key of DEAL_PARAMETER_KEYS) {
    const value = parameterValueFromMetadata(metadata, key);
    if (value === null) continue;
    filled++;
    const confidence = metadata[key]?.confidence;
    confidenceSum +=
      typeof confidence === "number" && !Number.isNaN(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.6;
  }

  const coverage = filled / DEAL_PARAMETER_KEYS.length;
  const avgConfidence = filled > 0 ? confidenceSum / filled : 0;
  return coverage * 0.55 + avgConfidence * 0.45;
}

function scoreGoverningLawAlignment(
  governingLaw: string | null,
  brief: ProformaBrief
): number {
  if (!governingLaw?.trim()) return 0.35;

  const hints: string[] = [];
  for (const key of DEAL_PARAMETER_KEYS) {
    const value = brief[key];
    if (value === null || value === undefined) continue;
    hints.push(String(value));
  }

  if (hints.length === 0) return governingLaw.trim() ? 0.7 : 0.35;

  let best = 0;
  for (const hint of hints) {
    best = Math.max(best, tokenOverlap(governingLaw, hint));
  }
  return Math.max(0.5, best);
}

function scoreDocumentFit(
  documentType: string | null,
  dealType: string | null,
  fullText: string | null,
  briefDealType?: string
): number {
  let score = 0;

  if (documentType === "LOI") score += 0.5;
  else if (documentType) score += 0.2;

  if (dealType && briefDealType && dealType === briefDealType) score += 0.3;
  else if (dealType === "LEASE") score += 0.15;

  const textLen = fullText?.trim().length ?? 0;
  if (textLen >= 8000) score += 0.2;
  else if (textLen >= 3000) score += 0.12;
  else if (textLen >= 800) score += 0.05;

  return Math.min(1, score);
}

/** How suitable a document is as an LOI template / boilerplate donor. */
export function computeTemplateFitness(
  doc: TemplateFitnessInput,
  brief: ProformaBrief,
  options?: { briefDealType?: string }
): TemplateFitnessResult {
  const breakdown: TemplateFitnessBreakdown = {
    governingLaw: scoreGoverningLawAlignment(doc.governingLaw, brief),
    recency: scoreRecency(doc.effectiveDate, doc.createdAt),
    extractionCoverage: scoreExtractionCoverage(doc.metadata),
    documentFit: scoreDocumentFit(
      doc.documentType,
      doc.dealType,
      doc.fullText,
      options?.briefDealType
    ),
  };

  const score =
    breakdown.governingLaw * 0.35 +
    breakdown.recency * 0.25 +
    breakdown.extractionCoverage * 0.25 +
    breakdown.documentFit * 0.15;

  return { score, breakdown };
}

export function pickTemplateDonor<T extends TemplateFitnessInput & { id: string }>(
  docs: T[],
  brief: ProformaBrief,
  matchScores: Map<string, number>,
  options?: { briefDealType?: string }
): T | null {
  if (docs.length === 0) return null;

  let best: { doc: T; fitness: number; match: number } | null = null;

  for (const doc of docs) {
    const fitness = computeTemplateFitness(doc, brief, options).score;
    const match = matchScores.get(doc.id) ?? 0;
    if (
      !best ||
      fitness > best.fitness ||
      (fitness === best.fitness && match > best.match)
    ) {
      best = { doc, fitness, match };
    }
  }

  return best?.doc ?? null;
}

export function parameterConfidence(
  metadata: DocumentMetadataJson | null | undefined,
  key: DealParameterKey
): number {
  const confidence = metadata?.[key]?.confidence;
  if (typeof confidence === "number" && !Number.isNaN(confidence)) {
    return Math.min(1, Math.max(0, confidence));
  }
  const value = parameterValueFromMetadata(metadata, key);
  return value !== null ? 0.6 : 0;
}

export function scoreParameterAgainstBrief(
  key: DealParameterKey,
  brief: ProformaBrief,
  metadata: DocumentMetadataJson | null | undefined,
  docMatchScore: number
): number {
  const docValue = parameterValueFromMetadata(metadata, key);
  if (docValue === null) return 0;

  const briefValue = brief[key];
  if (briefValue !== null && briefValue !== undefined && String(briefValue).trim()) {
    return scoreParameterPair(key, briefValue, docValue);
  }

  const confidence = parameterConfidence(metadata, key);
  return confidence * 0.5 + docMatchScore * 0.3 + 0.2;
}
