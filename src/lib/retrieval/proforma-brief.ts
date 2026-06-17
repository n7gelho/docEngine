import {
  DEAL_PARAMETER_KEYS,
  type DealParameterKey,
  parseDealParameters,
  parseMonthlyRentAmount,
} from "@/lib/extraction/deal-parameters";
import type { DocumentMetadataJson } from "@/lib/db/schema";
import { normalizeAircraftModelCode } from "@/lib/retrieval/aircraft-model";

/** Relative importance when aggregating precedent similarity (default 1). */
export const DEAL_PARAMETER_WEIGHTS: Record<DealParameterKey, number> = {
  counterparty: 3,
  aircraft: 3,
  aircraft_count: 1,
  transaction_type: 1,
  lease_term: 1,
  monthly_rent: 1,
  security_deposit: 1,
  maintenance_reserve: 1,
  insurance: 1,
  expected_delivery: 1,
};

export function getParameterWeight(key: DealParameterKey): number {
  return DEAL_PARAMETER_WEIGHTS[key] ?? 1;
}

/** User-provided proforma values (sparse — only filled fields are compared). */
export type ProformaBrief = Partial<
  Record<DealParameterKey, string | number | null>
>;

export const DEAL_PARAMETER_LABELS: Record<DealParameterKey, string> = {
  counterparty: "Counterparty",
  aircraft: "Aircraft",
  aircraft_count: "Number of aircraft",
  transaction_type: "Transaction type",
  lease_term: "Lease term",
  monthly_rent: "Monthly rent",
  security_deposit: "Security deposit",
  maintenance_reserve: "Maintenance reserve",
  insurance: "Insurance",
  expected_delivery: "Expected delivery",
};

export const DEAL_PARAMETER_CHAT_PROMPTS: Record<DealParameterKey, string> = {
  counterparty:
    "Who is the counterparty (lessee for a lease, buyer for a purchase)?",
  aircraft: "What aircraft type or model (e.g. Boeing 777-9)?",
  aircraft_count: "How many aircraft are in the deal?",
  transaction_type: "What is the transaction type (e.g. dry lease, wet lease)?",
  lease_term: "What is the lease term?",
  monthly_rent: "What is the monthly rent?",
  security_deposit: "What is the security deposit?",
  maintenance_reserve: "What are the maintenance reserve terms?",
  insurance: "What are the insurance requirements?",
  expected_delivery: "What is the expected delivery date or period?",
};

export function normalizeBriefValue(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function getFilledBriefKeys(brief: ProformaBrief): DealParameterKey[] {
  return DEAL_PARAMETER_KEYS.filter((key) => normalizeBriefValue(brief[key]) !== null);
}

export function briefFromUnknownInput(
  input: Record<string, unknown>
): ProformaBrief {
  const brief: ProformaBrief = {};
  for (const key of DEAL_PARAMETER_KEYS) {
    const value = input[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string" || typeof value === "number") {
      brief[key] = value;
    }
  }
  return brief;
}

export function parameterValueFromMetadata(
  metadata: DocumentMetadataJson | null | undefined,
  key: DealParameterKey
): string | number | null {
  const parameters = parseDealParameters(metadata);
  if (!parameters) return null;
  const value = parameters[key]?.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenOverlapScore(a: string, b: string): number {
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

function parseNumericValue(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return parseMonthlyRentAmount(String(value));
}

function numericSimilarity(
  a: string | number | null,
  b: string | number | null,
  toleranceRatio = 0.15
): number {
  const left = parseNumericValue(a);
  const right = parseNumericValue(b);
  if (left === null || right === null) return 0;
  if (left === right) return 1;
  const max = Math.max(Math.abs(left), Math.abs(right), 1);
  const diff = Math.abs(left - right) / max;
  return diff <= toleranceRatio ? 1 - diff / toleranceRatio : 0;
}

export function scoreParameterPair(
  key: DealParameterKey,
  briefValue: string | number,
  docValue: string | number | null
): number {
  if (docValue === null || docValue === undefined) return 0;
  const left = String(briefValue).trim();
  const right = String(docValue).trim();
  if (!left || !right) return 0;

  switch (key) {
    case "aircraft":
      return normalizeAircraftModelCode(left) === normalizeAircraftModelCode(right)
        ? 1
        : 0;
    case "aircraft_count":
      return numericSimilarity(briefValue, docValue, 0);
    case "monthly_rent":
    case "security_deposit":
      return Math.max(
        numericSimilarity(briefValue, docValue, 0.2),
        tokenOverlapScore(left, right)
      );
    case "lease_term":
      return Math.max(
        tokenOverlapScore(left, right),
        numericSimilarity(briefValue, docValue, 0.25)
      );
    default:
      return tokenOverlapScore(left, right);
  }
}

export type ParameterMatchDetail = {
  key: DealParameterKey;
  label: string;
  briefValue: string;
  documentValue: string | null;
  score: number;
  matched: boolean;
  weight: number;
};

export type PrecedentScore = {
  comparedParameters: number;
  matchedParameters: number;
  /** Sum of weights for parameters that matched (score ≥ 0.75). */
  matchedWeight: number;
  /** Sum of weights for all compared parameters. */
  comparedWeight: number;
  score: number;
  matches: ParameterMatchDetail[];
};

export function scoreDocumentAgainstBrief(
  brief: ProformaBrief,
  metadata: DocumentMetadataJson | null | undefined
): PrecedentScore {
  const parameters = parseDealParameters(metadata);
  const filledKeys = getFilledBriefKeys(brief);
  const matches: ParameterMatchDetail[] = [];

  let compared = 0;
  let matched = 0;
  let weightedScoreSum = 0;
  let comparedWeight = 0;
  let matchedWeight = 0;

  for (const key of filledKeys) {
    const briefValue = normalizeBriefValue(brief[key]);
    if (!briefValue) continue;

    const weight = getParameterWeight(key);
    compared++;
    comparedWeight += weight;

    const docRaw = parameters?.[key]?.value ?? null;
    const docComparable =
      typeof docRaw === "string" || typeof docRaw === "number" ? docRaw : null;
    const docValue =
      docComparable === null ? null : String(docComparable).trim();
    const pairScore = scoreParameterPair(key, briefValue, docComparable);
    const isMatch = pairScore >= 0.75;

    if (isMatch) {
      matched++;
      matchedWeight += weight;
    }
    weightedScoreSum += pairScore * weight;

    matches.push({
      key,
      label: DEAL_PARAMETER_LABELS[key],
      briefValue,
      documentValue: docValue,
      score: pairScore,
      matched: isMatch,
      weight,
    });
  }

  return {
    comparedParameters: compared,
    matchedParameters: matched,
    matchedWeight,
    comparedWeight,
    score: comparedWeight > 0 ? weightedScoreSum / comparedWeight : 0,
    matches,
  };
}
