import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import { parseMonthlyRentAmount } from "@/lib/extraction/deal-parameters";

export type ReplacementPair = {
  from: string;
  to: string;
};

function uniquePairs(pairs: ReplacementPair[]): ReplacementPair[] {
  const seen = new Set<string>();
  const out: ReplacementPair[] = [];
  for (const pair of pairs) {
    const from = pair.from.trim();
    const to = pair.to.trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    const key = `${from.toLowerCase()}→${to.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

function formatAmount(value: number, options?: { currency?: string | null }): string[] {
  const currency = options?.currency?.trim().toUpperCase();
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  const variants = new Set<string>();
  variants.add(formatted);
  variants.add(formatted.replace(/\.00$/, ""));
  if (currency) {
    variants.add(`${currency} ${formatted}`);
    variants.add(`${currency}${formatted}`);
    variants.add(`${currency} ${formatted.replace(/\.00$/, "")}`);
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const m = millions % 1 === 0 ? String(millions) : millions.toFixed(1);
    variants.add(`${m}m`);
    variants.add(`${m}M`);
    if (currency) {
      variants.add(`${currency} ${m}m`);
      variants.add(`${currency} ${m}M`);
      variants.add(`${currency}${m}m`);
    }
  }
  return Array.from(variants);
}

function amountVariants(
  precedentRaw: string,
  proformaRaw: string,
  currency?: string | null
): ReplacementPair[] {
  const precedentAmount = parseMonthlyRentAmount(precedentRaw);
  const proformaAmount = parseMonthlyRentAmount(proformaRaw, currency);
  if (precedentAmount === null || proformaAmount === null) {
    return [{ from: precedentRaw, to: proformaRaw }];
  }

  const pairs: ReplacementPair[] = [];
  const precedentFormats = formatAmount(precedentAmount, { currency });
  const proformaFormats = formatAmount(proformaAmount, { currency });
  const target = proformaFormats[0] ?? proformaRaw;

  for (const from of precedentFormats) {
    pairs.push({ from, to: target });
  }
  pairs.push({ from: precedentRaw, to: proformaRaw });
  return uniquePairs(pairs);
}

function partyVariants(precedent: string, proforma: string): ReplacementPair[] {
  const pairs: ReplacementPair[] = [{ from: precedent, to: proforma }];
  const stripSuffix = (value: string) =>
    value
      .replace(/\s+(Ltd\.?|Limited|LLC|Inc\.?|Corp\.?|Corporation|PLC|B\.?V\.?)$/i, "")
      .trim();

  const pShort = stripSuffix(precedent);
  const fShort = stripSuffix(proforma);
  if (pShort && fShort && pShort !== precedent) {
    pairs.push({ from: pShort, to: fShort });
    pairs.push({ from: precedent, to: fShort });
  }
  return uniquePairs(pairs);
}

/** Common lessor aliases (e.g. BOCA → Bank of China Aviation). */
export function buildLessorAliasPairs(canonicalLessor: string): ReplacementPair[] {
  const primary = canonicalLessor
    .split("\n")[0]
    ?.replace(/\s*,\s*and\/or\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!primary) return [];

  const pairs: ReplacementPair[] = [];
  const words = primary.split(/\s+/).filter(
    (word) => !/^(?:and|or|of|the|&)$/i.test(word)
  );
  const acronym = words
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  if (acronym.length >= 2 && acronym.length <= 6) {
    pairs.push({ from: acronym, to: primary });
  }

  if (/bank of china aviation/i.test(primary)) {
    pairs.push({ from: "BOCA", to: primary });
  }

  return uniquePairs(pairs);
}

const AMOUNT_KEYS = new Set<DealParameterKey>([
  "monthly_rent",
  "security_deposit",
]);

export function buildReplacementPairs(
  key: DealParameterKey,
  precedentValue: string,
  proformaValue: string,
  currency?: string | null
): ReplacementPair[] {
  if (AMOUNT_KEYS.has(key)) {
    return amountVariants(precedentValue, proformaValue, currency);
  }
  if (key === "counterparty" || key === "aircraft") {
    return partyVariants(precedentValue, proformaValue);
  }
  return [{ from: precedentValue, to: proformaValue }];
}

export function buildGoverningLawPairs(
  precedentLaw: string | null | undefined,
  proformaLaw: string | null | undefined
): ReplacementPair[] {
  const from = precedentLaw?.trim();
  const to = proformaLaw?.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return [];

  const pairs: ReplacementPair[] = [{ from, to }];
  const stripLawsOf = (value: string) =>
    value.replace(/^the\s+/i, "").replace(/^laws?\s+of\s+(the\s+)?/i, "").trim();

  const fromCore = stripLawsOf(from);
  const toCore = stripLawsOf(to);
  if (fromCore && toCore) {
    pairs.push({ from: fromCore, to: toCore });
    pairs.push({ from: `laws of ${fromCore}`, to: `laws of ${toCore}` });
    pairs.push({
      from: `the laws of ${fromCore}`,
      to: `the laws of ${toCore}`,
    });
  }
  return uniquePairs(pairs);
}
