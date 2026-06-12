import type { Document } from "@/lib/db/schema";

export const AUTO_LINK_THRESHOLD = 0.75;

export function normalizeToken(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokensMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function oppositeDocumentType(
  documentType: Document["documentType"] | string | null
): Document["documentType"] | null {
  if (documentType === "LOI") return "OLA";
  if (documentType === "OLA") return "LOI";
  return null;
}

export function roleForDocumentType(
  documentType: Document["documentType"] | string | null
): "loi" | "ola" | null {
  if (documentType === "LOI") return "loi";
  if (documentType === "OLA") return "ola";
  return null;
}

export function scoreDocumentPair(
  source: Document,
  candidate: Document
): number {
  if (source.dealType && candidate.dealType && source.dealType !== candidate.dealType) {
    return 0;
  }

  let score = 0;

  if (tokensMatch(source.msn, candidate.msn)) {
    score += 0.45;
  }
  if (tokensMatch(source.registration, candidate.registration)) {
    score += 0.35;
  }

  if (source.dealType === "PURCHASE") {
    if (tokensMatch(source.seller, candidate.seller)) score += 0.12;
    if (tokensMatch(source.buyer, candidate.buyer)) score += 0.12;
  } else {
    if (tokensMatch(source.lessor, candidate.lessor)) score += 0.12;
    if (tokensMatch(source.lessee, candidate.lessee)) score += 0.12;
  }

  if (tokensMatch(source.aircraftType, candidate.aircraftType)) {
    score += 0.06;
  }

  return Math.min(score, 1);
}

export function shouldAutoLink(
  score: number,
  source: Document,
  candidate: Document
): boolean {
  if (score < AUTO_LINK_THRESHOLD) return false;

  const hasStrongIdentifier =
    tokensMatch(source.msn, candidate.msn) ||
    tokensMatch(source.registration, candidate.registration);

  if (hasStrongIdentifier) return true;

  if (source.dealType === "PURCHASE") {
    return (
      score >= 0.85 &&
      tokensMatch(source.seller, candidate.seller) &&
      tokensMatch(source.buyer, candidate.buyer)
    );
  }

  return (
    score >= 0.85 &&
    tokensMatch(source.lessor, candidate.lessor) &&
    tokensMatch(source.lessee, candidate.lessee)
  );
}

export function summarizeDealFields(source: Document, candidate: Document) {
  const dealType = source.dealType ?? candidate.dealType ?? "LEASE";
  return {
    dealType,
    lessor: source.lessor ?? candidate.lessor,
    lessee: source.lessee ?? candidate.lessee,
    seller: source.seller ?? candidate.seller,
    buyer: source.buyer ?? candidate.buyer,
    msn: source.msn ?? candidate.msn,
    aircraftType: source.aircraftType ?? candidate.aircraftType,
    registration: source.registration ?? candidate.registration,
  };
}
