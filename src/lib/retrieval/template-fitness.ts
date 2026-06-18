import type { DocumentMetadataJson } from "@/lib/db/schema";
import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import {
  getProformaGoverningLaw,
  parameterValueFromMetadata,
  scoreParameterPair,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";

export type SuitabilityInput = {
  governingLaw: string | null;
  createdAt: Date;
};

export type SuitabilityBreakdown = {
  /** Null when the user did not provide proforma governing law. */
  governingLaw: number | null;
  recency: number;
};

export type SuitabilityResult = {
  score: number;
  breakdown: SuitabilityBreakdown;
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Generic legal phrasing — not jurisdiction identifiers. */
const GOVERNING_LAW_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "applicable",
  "are",
  "as",
  "be",
  "by",
  "civil",
  "clause",
  "common",
  "contract",
  "court",
  "courts",
  "document",
  "for",
  "forum",
  "governed",
  "governing",
  "in",
  "is",
  "its",
  "jurisdiction",
  "law",
  "laws",
  "legal",
  "of",
  "or",
  "provisions",
  "pursuant",
  "shall",
  "system",
  "the",
  "to",
  "under",
  "with",
]);

function stripGoverningLawBoilerplate(normalized: string): string {
  return normalized
    .replace(/^(the\s+)?(laws?\s+of\s+(the\s+)?)/, "")
    .replace(/^(the\s+)?(law\s+of\s+(the\s+)?)/, "")
    .replace(/^state\s+of\s+/, "")
    .replace(/\s+(shall|will|is|are|govern(s|ing)?|apply|applies)\b.*$/, "")
    .trim();
}

/** Tokens that identify the jurisdiction (e.g. england, china, new, york). */
export function meaningfulGoverningLawTokens(value: string): string[] {
  const stripped = stripGoverningLawBoilerplate(normalizeToken(value));
  if (!stripped) return [];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of stripped.split(" ")) {
    if (token.length <= 1 || GOVERNING_LAW_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export function governingLawTokenOverlap(a: string, b: string): number {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;

  const leftTokens = meaningfulGoverningLawTokens(a);
  const rightTokens = meaningfulGoverningLawTokens(b);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    const leftFallback = new Set(left.split(" ").filter((t) => t.length > 1));
    const rightFallback = new Set(right.split(" ").filter((t) => t.length > 1));
    if (leftFallback.size === 0 || rightFallback.size === 0) return 0;
    let shared = 0;
    for (const token of leftFallback) {
      if (rightFallback.has(token)) shared++;
    }
    return shared / Math.max(leftFallback.size, rightFallback.size);
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);

  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) shared++;
  }

  if (shared === 0) return 0;

  const leftAllInRight = [...leftSet].every((t) => rightSet.has(t));
  const rightAllInLeft = [...rightSet].every((t) => leftSet.has(t));
  if (leftAllInRight || rightAllInLeft) return 0.9;

  const union = new Set([...leftSet, ...rightSet]).size;
  return shared / union;
}

/** Recency from when the document was processed into the library. */
export function scoreRecency(createdAt: Date): number {
  const year = createdAt.getFullYear();
  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - year);
  if (age <= 1) return 1;
  if (age <= 3) return 0.85;
  if (age <= 5) return 0.65;
  if (age <= 8) return 0.45;
  return 0.25;
}

export function scoreGoverningLawAlignment(
  precedentGoverningLaw: string | null,
  proformaGoverningLaw: string | null | undefined
): number {
  if (!precedentGoverningLaw?.trim()) return 0;
  if (!proformaGoverningLaw?.trim()) return 0;
  return governingLawTokenOverlap(proformaGoverningLaw, precedentGoverningLaw);
}

/** Legal and temporal suitability for precedent reuse. */
export function computeSuitabilityScore(
  doc: SuitabilityInput,
  brief: ProformaBrief
): SuitabilityResult {
  const recency = scoreRecency(doc.createdAt);
  const proformaLaw = getProformaGoverningLaw(brief);

  if (!proformaLaw) {
    return {
      score: recency,
      breakdown: { governingLaw: null, recency },
    };
  }

  const governingLaw = scoreGoverningLawAlignment(
    doc.governingLaw,
    proformaLaw
  );

  return {
    score: governingLaw * 0.5 + recency * 0.5,
    breakdown: { governingLaw, recency },
  };
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
