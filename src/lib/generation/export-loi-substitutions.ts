import type { Document } from "@/lib/db/schema";
import { buildDealParameters, type DealParameterKey } from "@/lib/extraction/deal-parameters";
import {
  reconcileBoilerplateWithProforma,
  type ReconcileSubstitution,
} from "@/lib/generation/proforma-reconcile";
import type { ProformaBrief } from "@/lib/retrieval/proforma-brief";
import { getFilledBriefKeys } from "@/lib/retrieval/proforma-brief";

function parameterValueAsString(
  value: string | number | boolean | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value).trim();
  return text || null;
}

/** Build substitution pairs to apply proforma values onto the template donor text. */
export function buildTemplateSubstitutions(
  templateDoc: Pick<
    Document,
    | "fullText"
    | "dealType"
    | "metadata"
    | "lessor"
    | "lessee"
    | "seller"
    | "buyer"
    | "aircraftType"
    | "term"
    | "leaseType"
    | "monthlyRent"
    | "currency"
    | "securityDeposit"
    | "expectedDelivery"
    | "aircraftCount"
    | "governingLaw"
  >,
  brief: ProformaBrief
): ReconcileSubstitution[] {
  const templateText = templateDoc.fullText?.trim();
  if (!templateText || getFilledBriefKeys(brief).length === 0) {
    return [];
  }

  const { parameters } = buildDealParameters({
    dealType: (templateDoc.dealType as "LEASE" | "PURCHASE") ?? "LEASE",
    documentType: "LOI",
    metadata: templateDoc.metadata ?? {},
    lessor: templateDoc.lessor,
    lessee: templateDoc.lessee,
    seller: templateDoc.seller,
    buyer: templateDoc.buyer,
    aircraftType: templateDoc.aircraftType,
    term: templateDoc.term,
    leaseType: templateDoc.leaseType,
    monthlyRent: templateDoc.monthlyRent,
    currency: templateDoc.currency,
    securityDeposit: templateDoc.securityDeposit,
    expectedDelivery: templateDoc.expectedDelivery,
    aircraftCount: templateDoc.aircraftCount,
  });

  const precedentValues: Partial<Record<DealParameterKey, string | null>> = {};
  for (const key of Object.keys(parameters) as DealParameterKey[]) {
    const raw = parameters[key]?.value ?? null;
    precedentValues[key] = parameterValueAsString(raw);
  }
  if (templateDoc.lessee) {
    precedentValues.counterparty =
      precedentValues.counterparty ?? templateDoc.lessee;
  }

  const result = reconcileBoilerplateWithProforma(
    templateText,
    brief,
    precedentValues,
    {
      governingLaw: templateDoc.governingLaw,
      lessor: templateDoc.lessor,
      lessee: templateDoc.lessee,
      seller: templateDoc.seller,
      buyer: templateDoc.buyer,
      currency: templateDoc.currency,
    }
  );

  const seen = new Set<string>();
  return result.substitutions.filter((sub) => {
    const key = `${sub.from.toLowerCase()}→${sub.to.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return sub.from.trim().length >= 3 && sub.to.trim().length > 0;
  });
}

export function substitutionsNeedLayoutChange(
  substitutions: ReconcileSubstitution[]
): boolean {
  return substitutions.some(
    (sub) => sub.to.trim().length > sub.from.trim().length * 2.5
  );
}

export function filterInPlaceSubstitutions(
  substitutions: ReconcileSubstitution[]
): ReconcileSubstitution[] {
  return substitutions.filter(
    (sub) => sub.to.trim().length <= sub.from.trim().length * 2.5
  );
}
