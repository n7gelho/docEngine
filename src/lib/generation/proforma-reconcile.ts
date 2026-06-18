import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import { parseMonthlyRentAmount } from "@/lib/extraction/deal-parameters";
import {
  DEAL_PARAMETER_LABELS,
  getProformaGoverningLaw,
  normalizeBriefValue,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import {
  buildGoverningLawPairs,
  buildReplacementPairs,
  type ReplacementPair,
} from "@/lib/generation/reconcile-variants";

export type ReconcileSubstitution = {
  key: DealParameterKey | "governing_law";
  label: string;
  from: string;
  to: string;
};

export type ReconcileResult = {
  text: string;
  substitutions: ReconcileSubstitution[];
  reconciled: boolean;
};

export type ReconcilePrecedentExtras = {
  governingLaw?: string | null;
  lessor?: string | null;
  lessee?: string | null;
  seller?: string | null;
  buyer?: string | null;
  currency?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const AMOUNT_PARAMETER_KEYS = new Set<DealParameterKey>([
  "monthly_rent",
  "security_deposit",
]);

function sortPairsLongestFirst(pairs: ReplacementPair[]): ReplacementPair[] {
  return [...pairs].sort(
    (a, b) => b.from.trim().length - a.from.trim().length
  );
}

function isSafeAmountReplacement(from: string): boolean {
  const trimmed = from.trim();
  if (trimmed.length < 4) return false;
  if (/^\d{1,2}$/.test(trimmed)) return false;
  if (/[\$,]/.test(trimmed)) return true;
  if (/\d{3,}/.test(trimmed)) return true;
  return parseMonthlyRentAmount(trimmed) !== null;
}

function replaceAllInsensitive(
  text: string,
  from: string,
  to: string,
  options?: { amountKey?: boolean }
): { text: string; count: number } {
  if (!from.trim() || from.trim() === to.trim()) {
    return { text, count: 0 };
  }

  if (options?.amountKey && !isSafeAmountReplacement(from)) {
    return { text, count: 0 };
  }

  const escaped = escapeRegExp(from.trim());
  const pattern = options?.amountKey
    ? new RegExp(`(?<![\\d,])${escaped}(?![\\d,])`, "gi")
    : new RegExp(escaped, "gi");

  let count = 0;
  const next = text.replace(pattern, () => {
    count++;
    return to.trim();
  });
  return { text: next, count };
}

function applyReplacementPairs(
  text: string,
  pairs: ReplacementPair[],
  meta: { key: DealParameterKey | "governing_law"; label: string },
  substitutions: ReconcileSubstitution[]
): string {
  let next = text;
  const amountKey = AMOUNT_PARAMETER_KEYS.has(meta.key as DealParameterKey);
  for (const pair of sortPairsLongestFirst(pairs)) {
    const { text: updated, count } = replaceAllInsensitive(
      next,
      pair.from,
      pair.to,
      { amountKey }
    );
    if (count > 0) {
      next = updated;
      substitutions.push({
        key: meta.key,
        label: meta.label,
        from: pair.from,
        to: pair.to,
      });
    }
  }
  return next;
}

/** Reconcile ported boilerplate with proforma values (multi-format amounts, parties, law). */
export function reconcileBoilerplateWithProforma(
  boilerplate: string,
  brief: ProformaBrief,
  precedentValues: Partial<Record<DealParameterKey, string | null>>,
  extras?: ReconcilePrecedentExtras
): ReconcileResult {
  let text = boilerplate;
  const substitutions: ReconcileSubstitution[] = [];

  for (const key of Object.keys(precedentValues) as DealParameterKey[]) {
    const proformaValue = normalizeBriefValue(brief[key]);
    const precedentValue = precedentValues[key]?.trim() ?? null;
    if (!proformaValue || !precedentValue) continue;
    if (proformaValue.toLowerCase() === precedentValue.toLowerCase()) continue;

    const pairs = buildReplacementPairs(
      key,
      precedentValue,
      proformaValue,
      extras?.currency
    );
    text = applyReplacementPairs(text, pairs, {
      key,
      label: DEAL_PARAMETER_LABELS[key],
    }, substitutions);
  }

  const proformaLaw = getProformaGoverningLaw(brief);
  const governingPairs = buildGoverningLawPairs(
    extras?.governingLaw,
    proformaLaw
  );
  text = applyReplacementPairs(text, governingPairs, {
    key: "governing_law",
    label: "Governing law",
  }, substitutions);

  const partyPairs: Array<{ from: string | null | undefined; to: string | null | undefined; label: string }> = [
    { from: extras?.lessor, to: normalizeBriefValue(brief.counterparty), label: "Lessor" },
    { from: extras?.lessee, to: normalizeBriefValue(brief.counterparty), label: "Lessee" },
    { from: extras?.seller, to: normalizeBriefValue(brief.counterparty), label: "Seller" },
    { from: extras?.buyer, to: normalizeBriefValue(brief.counterparty), label: "Buyer" },
  ];

  for (const party of partyPairs) {
    const from = party.from?.trim();
    const to = party.to?.trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    if (precedentValues.counterparty && from === precedentValues.counterparty.trim()) {
      continue;
    }
    const pairs = buildReplacementPairs("counterparty", from, to);
    text = applyReplacementPairs(text, pairs, {
      key: "counterparty",
      label: party.label,
    }, substitutions);
  }

  return {
    text,
    substitutions,
    reconciled: substitutions.length > 0,
  };
}
