import { normalizeBriefValue } from "@/lib/retrieval/proforma-brief";

export type PartyTextBlock = { key: string; label: string; text: string };

export type LessorResolutionInput = {
  brief?: { counterparty?: string | number | null } | null;
  templateDoc?: {
    lessor?: string | null;
    lessee?: string | null;
    fullText?: string | null;
  } | null;
};

export function primaryPartyName(value: string): string {
  return value
    .split("\n")[0]
    ?.replace(/\s*,\s*and\/or\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePartyName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isSamePartyName(a: string, b: string): boolean {
  const left = normalizePartyName(a);
  const right = normalizePartyName(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

export function isLesseeNotLessor(
  candidate: string,
  proformaLessee: string | null
): boolean {
  if (!proformaLessee?.trim() || !candidate.trim()) return false;
  return isSamePartyName(candidate, proformaLessee);
}

export function extractLessorFromPartyText(text: string): string | null {
  const match = text.match(/(?:^|\n)\s*Lessor\s*(?:\n|:)\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

export function extractLessorFromBlocks(
  blocks: PartyTextBlock[]
): string | null {
  for (const block of blocks) {
    const fromLine = extractLessorFromPartyText(block.text);
    if (fromLine) return fromLine;
  }
  return null;
}

export function resolveAuthoritativeLessorName(
  input: LessorResolutionInput,
  blocks?: PartyTextBlock[]
): string | null {
  const proformaLessee = normalizeBriefValue(input.brief?.counterparty);
  const candidates: Array<string | null | undefined> = [
    input.templateDoc?.fullText
      ? extractLessorFromPartyText(input.templateDoc.fullText)
      : null,
    blocks ? extractLessorFromBlocks(blocks) : null,
    input.templateDoc?.lessor,
  ];

  for (const candidate of candidates) {
    const primary = candidate ? primaryPartyName(candidate) : null;
    if (!primary) continue;
    if (proformaLessee && isLesseeNotLessor(primary, proformaLessee)) continue;
    return primary;
  }

  return null;
}

export function collectWrongLesseeNames(options: {
  proformaLessee: string | null;
  templateLessee?: string | null;
  precedentLessee?: string | null;
  portedLessee?: string | null;
}): string[] {
  const keep = options.proformaLessee?.trim();
  if (!keep) return [];

  const names = new Set<string>();
  for (const value of [
    options.templateLessee,
    options.precedentLessee,
    options.portedLessee,
  ]) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (isSamePartyName(trimmed, keep)) continue;
    names.add(trimmed);
    const short = primaryPartyName(trimmed);
    if (short && !isSamePartyName(short, keep)) names.add(short);
  }

  return Array.from(names);
}

/** Replace stray lessee names unless they appear in a Previous Lessee context. */
export function replaceWrongLesseeNamesOutsidePreviousLessee(
  text: string,
  wrongNames: string[],
  proformaLessee: string
): string {
  if (!text.trim() || wrongNames.length === 0) return text;

  let next = text;
  for (const wrong of wrongNames.sort((a, b) => b.length - a.length)) {
    if (!wrong.trim() || isSamePartyName(wrong, proformaLessee)) continue;
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    next = next.replace(pattern, (match, offset) => {
      const window = next.slice(Math.max(0, offset - 120), offset);
      if (/previous\s+lessee/i.test(window)) return match;
      return proformaLessee;
    });
  }

  return next;
}
