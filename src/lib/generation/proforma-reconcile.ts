import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import {
  DEAL_PARAMETER_LABELS,
  normalizeBriefValue,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";

export type ReconcileSubstitution = {
  key: DealParameterKey;
  label: string;
  from: string;
  to: string;
};

export type ReconcileResult = {
  text: string;
  substitutions: ReconcileSubstitution[];
  reconciled: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllInsensitive(
  text: string,
  from: string,
  to: string
): { text: string; count: number } {
  if (!from.trim() || from.trim() === to.trim()) {
    return { text, count: 0 };
  }

  const pattern = new RegExp(escapeRegExp(from.trim()), "gi");
  let count = 0;
  const next = text.replace(pattern, () => {
    count++;
    return to.trim();
  });
  return { text: next, count };
}

/** Simple v1 reconciliation: swap precedent deal facts for proforma values in ported boilerplate. */
export function reconcileBoilerplateWithProforma(
  boilerplate: string,
  brief: ProformaBrief,
  precedentValues: Partial<Record<DealParameterKey, string | null>>
): ReconcileResult {
  let text = boilerplate;
  const substitutions: ReconcileSubstitution[] = [];

  for (const key of Object.keys(precedentValues) as DealParameterKey[]) {
    const proformaValue = normalizeBriefValue(brief[key]);
    const precedentValue = precedentValues[key]?.trim() ?? null;
    if (!proformaValue || !precedentValue) continue;
    if (proformaValue.toLowerCase() === precedentValue.toLowerCase()) continue;

    const { text: updated, count } = replaceAllInsensitive(
      text,
      precedentValue,
      proformaValue
    );

    if (count > 0) {
      text = updated;
      substitutions.push({
        key,
        label: DEAL_PARAMETER_LABELS[key],
        from: precedentValue,
        to: proformaValue,
      });
    }
  }

  return {
    text,
    substitutions,
    reconciled: substitutions.length > 0,
  };
}
