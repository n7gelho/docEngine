import { formatRent } from "@/lib/types";

export type PrecedentSummaryInput = {
  documentType: string | null;
  dealType: string | null;
  lessor?: string | null;
  lessee?: string | null;
  seller?: string | null;
  buyer?: string | null;
  aircraftType?: string | null;
  term?: string | null;
  leaseType?: string | null;
  monthlyRent?: number | null;
  currency?: string | null;
  governingLaw?: string | null;
};

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  return text || null;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function leaseFlavor(leaseType: string | null | undefined): string {
  const text = clean(leaseType);
  if (!text) return "lease";
  return /\blease\b/i.test(text) ? lowerFirst(text) : `${lowerFirst(text)} lease`;
}

function documentLabel(documentType: string | null | undefined): string {
  return clean(documentType) ?? "document";
}

function partyClause(
  left: string | null,
  leftRole: string,
  right: string | null,
  rightRole: string
): string | null {
  if (left && right) {
    return `between ${left} (${leftRole}) and ${right} (${rightRole})`;
  }
  if (left) return `with ${left} as ${leftRole}`;
  if (right) return `with ${right} as ${rightRole}`;
  return null;
}

function aircraftClause(aircraftType: string | null | undefined): string | null {
  const aircraft = clean(aircraftType);
  if (!aircraft) return null;
  return `for ${aircraft}`;
}

function termClause(term: string | null | undefined): string | null {
  const text = clean(term);
  if (!text) return null;
  if (/\bterm\b/i.test(text)) return text;
  return `${text} term`;
}

function rentClause(
  monthlyRent: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (monthlyRent === null || monthlyRent === undefined) return null;
  const formatted = formatRent(monthlyRent, currency ?? null);
  if (formatted === "—") return null;
  return `${formatted} monthly rent`;
}

function governingLawClause(governingLaw: string | null | undefined): string | null {
  const law = clean(governingLaw);
  if (!law) return null;
  if (/^govern(ed|ing)\s+by\b/i.test(law)) return lowerFirst(law);
  if (/^laws?\s+of\b/i.test(law)) return `governed by the ${lowerFirst(law)}`;
  if (/^the\s+laws?\s+of\b/i.test(law)) return `governed by ${lowerFirst(law)}`;
  return `governed by ${lowerFirst(law)}`;
}

function joinDetailClauses(clauses: Array<string | null>): string {
  const parts = clauses.filter((clause): clause is string => Boolean(clause));
  if (parts.length === 0) return "";
  return `, ${parts.join(", ")}`;
}

/** Option B: short prose summary of the precedent deal context. */
export function formatPrecedentDealSummary(doc: PrecedentSummaryInput): string {
  const dealType = doc.dealType ?? "LEASE";
  const docType = documentLabel(doc.documentType);
  const aircraft = aircraftClause(doc.aircraftType);
  const governing = governingLawClause(doc.governingLaw);

  if (dealType === "PURCHASE") {
    const parties = partyClause(
      clean(doc.seller),
      "seller",
      clean(doc.buyer),
      "buyer"
    );
    const head = [`A ${docType}`, parties, aircraft].filter(Boolean).join(" ");
    const details = joinDetailClauses([governing]);
    if (head === `A ${docType}` && !aircraft && !governing) {
      return `A ${docType} for an aircraft purchase.`;
    }
    return `${head}${details}.`;
  }

  const parties = partyClause(
    clean(doc.lessor),
    "lessor",
    clean(doc.lessee),
    "lessee"
  );
  const head = [
    `A ${leaseFlavor(doc.leaseType)} ${docType}`,
    parties,
    aircraft,
  ]
    .filter(Boolean)
    .join(" ");

  const details = joinDetailClauses([
    termClause(doc.term),
    rentClause(doc.monthlyRent, doc.currency),
    governing,
  ]);

  if (!parties && !aircraft && !details) {
    return `A ${leaseFlavor(doc.leaseType)} ${docType} for an aircraft deal.`;
  }

  return `${head}${details}.`;
}
