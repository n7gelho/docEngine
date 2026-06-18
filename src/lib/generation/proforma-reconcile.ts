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
  buildLessorAliasPairs,
  buildReplacementPairs,
  type ReplacementPair,
} from "@/lib/generation/reconcile-variants";
import {
  collectWrongLesseeNames,
  replaceWrongLesseeNamesOutsidePreviousLessee,
} from "@/lib/generation/party-resolution";

export type ReconcileSubstitution = {
  key: DealParameterKey | "governing_law" | "lessor" | "lessee";
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
  /** Authoritative parties from the selected template donor. */
  templateLessor?: string | null;
  templateLessee?: string | null;
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
  meta: {
    key: DealParameterKey | "governing_law" | "lessor" | "lessee";
    label: string;
  },
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

  const proformaLessee = normalizeBriefValue(brief.counterparty);
  const templateLessor = extras?.templateLessor?.trim() ?? extras?.lessor?.trim() ?? null;
  const templateLessee = extras?.templateLessee?.trim() ?? null;

  if (proformaLessee) {
    const lesseeSources = new Set<string>();
    if (extras?.lessee?.trim()) lesseeSources.add(extras.lessee.trim());
    if (precedentValues.counterparty?.trim()) {
      lesseeSources.add(precedentValues.counterparty.trim());
    }
    if (templateLessee && templateLessee.toLowerCase() !== proformaLessee.toLowerCase()) {
      lesseeSources.add(templateLessee);
    }

    for (const from of lesseeSources) {
      if (from.toLowerCase() === proformaLessee.toLowerCase()) continue;
      const pairs = buildReplacementPairs("counterparty", from, proformaLessee);
      text = applyReplacementPairs(text, pairs, {
        key: "lessee",
        label: "Lessee",
      }, substitutions);
    }
  }

  if (templateLessor) {
    const lessorSources = new Set<string>();
    if (extras?.lessor?.trim()) lessorSources.add(extras.lessor.trim());

    for (const from of lessorSources) {
      if (from.toLowerCase() === templateLessor.toLowerCase()) continue;
      const pairs = buildReplacementPairs("counterparty", from, templateLessor);
      text = applyReplacementPairs(text, pairs, {
        key: "lessor",
        label: "Lessor",
      }, substitutions);
    }

    const aliasPairs = buildLessorAliasPairs(templateLessor);
    text = applyReplacementPairs(text, aliasPairs, {
      key: "lessor",
      label: "Lessor alias",
    }, substitutions);
  }

  const purchaseCounterparty = normalizeBriefValue(brief.counterparty);
  if (purchaseCounterparty) {
    const purchasePairs: Array<{
      from: string | null | undefined;
      label: string;
    }> = [
      { from: extras?.buyer, label: "Buyer" },
      { from: extras?.seller, label: "Seller" },
    ];
    for (const party of purchasePairs) {
      const from = party.from?.trim();
      if (!from || from.toLowerCase() === purchaseCounterparty.toLowerCase()) {
        continue;
      }
      const pairs = buildReplacementPairs(
        "counterparty",
        from,
        purchaseCounterparty
      );
      text = applyReplacementPairs(text, pairs, {
        key: "counterparty",
        label: party.label,
      }, substitutions);
    }
  }

  if (proformaLessee) {
    const wrongLesseeNames = collectWrongLesseeNames({
      proformaLessee,
      templateLessee: extras?.templateLessee,
      precedentLessee: extras?.lessee,
      portedLessee: precedentValues.counterparty,
    });
    text = replaceWrongLesseeNamesOutsidePreviousLessee(
      text,
      wrongLesseeNames,
      proformaLessee
    );
  }

  return {
    text,
    substitutions,
    reconciled: substitutions.length > 0,
  };
}

/** Apply brief/template party reconciliation when exporting stored draft text. */
export function reconcileTextForExport(
  text: string,
  brief: ProformaBrief | null | undefined,
  templateDoc?: {
    lessor?: string | null;
    lessee?: string | null;
    seller?: string | null;
    buyer?: string | null;
    governingLaw?: string | null;
    currency?: string | null;
  } | null
): string {
  if (!text.trim() || !brief) return text;

  const result = reconcileBoilerplateWithProforma(
    text,
    brief,
    {
      counterparty: normalizeBriefValue(brief.counterparty),
    },
    {
      governingLaw: templateDoc?.governingLaw,
      lessor: templateDoc?.lessor,
      lessee: templateDoc?.lessee,
      seller: templateDoc?.seller,
      buyer: templateDoc?.buyer,
      currency: templateDoc?.currency,
      templateLessor: templateDoc?.lessor,
      templateLessee: templateDoc?.lessee,
    }
  );

  return result.text;
}
