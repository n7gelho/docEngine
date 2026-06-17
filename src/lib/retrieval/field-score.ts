import type { DocumentMetadataJson } from "@/lib/db/schema";
import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import {
  scoreParameterPair,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import { parameterConfidence } from "@/lib/retrieval/template-fitness";

export const FIELD_STRONG_MATCH_THRESHOLD = 0.55;
export const FIELD_PROFORMA_GUIDED_THRESHOLD = 0.75;

export type FieldScoreInput = {
  briefKey?: DealParameterKey;
  brief: ProformaBrief;
  docValue: string | number | null;
  sectionText: string | null;
  metadata: DocumentMetadataJson | null | undefined;
  docMatchScore: number;
};

export type FieldScoreResult = {
  score: number;
  meetsThreshold: boolean;
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function textContainsValue(text: string, value: string): boolean {
  const hay = normalizeToken(text);
  const needle = normalizeToken(value);
  if (!hay || !needle) return false;
  return hay.includes(needle);
}

/** Score how well a precedent donates a specific field or section. */
export function scoreFieldDonor(input: FieldScoreInput): FieldScoreResult {
  const {
    briefKey,
    brief,
    docValue,
    sectionText,
    metadata,
    docMatchScore,
  } = input;

  const briefValue =
    briefKey && brief[briefKey] !== null && brief[briefKey] !== undefined
      ? String(brief[briefKey]).trim()
      : null;

  let score = 0;

  if (briefKey && briefValue && docValue !== null) {
    score = scoreParameterPair(briefKey, briefValue, docValue);
    if (sectionText && textContainsValue(sectionText, String(docValue))) {
      score = Math.min(1, score + 0.05);
    }
  } else if (briefKey && docValue !== null) {
    const confidence = parameterConfidence(metadata, briefKey);
    score = confidence * 0.5 + docMatchScore * 0.35 + 0.15;
    if (sectionText && textContainsValue(sectionText, String(docValue))) {
      score = Math.min(1, score + 0.1);
    }
  } else if (sectionText && sectionText.trim().length > 80) {
    score = docMatchScore * 0.4 + 0.35;
    const textLen = sectionText.trim().length;
    if (textLen >= 1500) score = Math.min(1, score + 0.15);
    else if (textLen >= 400) score = Math.min(1, score + 0.08);
  } else if (docValue !== null) {
    score = docMatchScore * 0.35 + 0.25;
  }

  const threshold = briefValue
    ? FIELD_PROFORMA_GUIDED_THRESHOLD
    : FIELD_STRONG_MATCH_THRESHOLD;

  return {
    score,
    meetsThreshold: score >= threshold,
  };
}

export function scoreSectionDonor(
  sectionText: string | null,
  mappedBriefKeys: DealParameterKey[],
  brief: ProformaBrief,
  metadata: DocumentMetadataJson | null | undefined,
  docMatchScore: number
): FieldScoreResult {
  if (!sectionText?.trim()) {
    return { score: 0, meetsThreshold: false };
  }

  if (mappedBriefKeys.length === 0) {
    return scoreFieldDonor({
      brief,
      docValue: null,
      sectionText,
      metadata,
      docMatchScore,
    });
  }

  let total = 0;
  let count = 0;
  let anyBriefFilled = false;

  for (const key of mappedBriefKeys) {
    const briefVal = brief[key];
    if (briefVal !== null && briefVal !== undefined && String(briefVal).trim()) {
      anyBriefFilled = true;
    }
    const docRaw = metadata?.[key]?.value;
    const docValue =
      typeof docRaw === "string" || typeof docRaw === "number" ? docRaw : null;
    const result = scoreFieldDonor({
      briefKey: key,
      brief,
      docValue,
      sectionText,
      metadata,
      docMatchScore,
    });
    total += result.score;
    count++;
  }

  const avg = count > 0 ? total / count : 0;
  const threshold = anyBriefFilled
    ? FIELD_PROFORMA_GUIDED_THRESHOLD
    : FIELD_STRONG_MATCH_THRESHOLD;

  return {
    score: avg,
    meetsThreshold: avg >= threshold,
  };
}
