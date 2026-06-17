const COMBINED_HEADING =
  /^governing\s+law\s*(?:and|&)\s*jurisdiction\s*$/im;
const STANDALONE_GOVERNING_LAW = /^governing\s+law\s*$/im;
const STANDALONE_JURISDICTION =
  /^jurisdiction\s*(?:and|&)\s*governing\s+law\s*$/im;

const SECTION_END_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*(?:notices|miscellaneous|entire agreement|signatures?|in witness whereof|no brokers?)\b/i,
  /(?:^|\n)\s*schedule\s+\d/i,
];

const SUBSTANTIVE_SIGNAL =
  /(?:laws of|governed by|construed in accordance with|courts of|jurisdiction to settle|exclusive jurisdiction)/i;

const FALLBACK_BODY_PATTERN =
  /(?:governed by[^.\n]{0,40}laws of|laws of[^.\n]{3,80})/i;

const DEFAULT_MAX_CHARS = 4000;

function textAlreadyIncluded(base: string, section: string): boolean {
  const normalizedBase = base.toLowerCase().replace(/\s+/g, " ");
  const probe = section
    .slice(0, Math.min(120, section.length))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (probe.length < 40) return false;
  return normalizedBase.includes(probe.slice(0, 80));
}

function sliceSection(
  fullText: string,
  startIndex: number,
  maxChars: number
): string {
  const sliceStart = startIndex;
  let sliceEnd = fullText.length;
  const after = fullText.slice(sliceStart + 40);

  for (const endPattern of SECTION_END_PATTERNS) {
    const endMatch = endPattern.exec(after);
    if (endMatch && endMatch.index >= 80) {
      sliceEnd = Math.min(sliceEnd, sliceStart + 40 + endMatch.index);
    }
  }

  return fullText
    .slice(sliceStart, Math.min(sliceEnd, sliceStart + maxChars))
    .trim();
}

function sectionHasSubstance(section: string): boolean {
  return SUBSTANTIVE_SIGNAL.test(section);
}

function findHeadingSections(
  fullText: string,
  pattern: RegExp,
  maxChars: number
): string | null {
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags);

  while ((match = re.exec(fullText)) !== null) {
    const section = sliceSection(fullText, match.index, maxChars);
    if (section.length >= 40 && sectionHasSubstance(section)) {
      return section;
    }
  }

  return null;
}

/**
 * Locate the governing law / jurisdiction block in LOI full text.
 * LOIs often place this late in the document, outside the scored extraction preview.
 */
export function extractLoiGoverningLawSection(
  fullText: string,
  maxChars = DEFAULT_MAX_CHARS
): string | null {
  for (const pattern of [
    COMBINED_HEADING,
    STANDALONE_JURISDICTION,
    STANDALONE_GOVERNING_LAW,
  ]) {
    const section = findHeadingSections(fullText, pattern, maxChars);
    if (section) return section;
  }

  const fallback = FALLBACK_BODY_PATTERN.exec(fullText);
  if (!fallback) return null;

  const start = Math.max(0, fallback.index - 200);
  const end = Math.min(
    fullText.length,
    fallback.index + fallback[0].length + 500
  );
  const section = fullText.slice(start, end).trim();
  return section.length >= 30 && sectionHasSubstance(section) ? section : null;
}

export function appendLoiGoverningLawSection(
  baseText: string,
  fullText: string
): string {
  const section = extractLoiGoverningLawSection(fullText);
  if (!section || textAlreadyIncluded(baseText, section)) {
    return baseText;
  }

  return `${baseText.trim()}\n\n--- GOVERNING LAW / JURISDICTION ---\n${section}`;
}
