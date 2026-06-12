import type { ParsedDocument } from "@/lib/parsing/parse-document";
import { getOlaSectionIds } from "@/lib/profiles/schema-registry";
import {
  getExtractionMaxPages,
  getExtractionScanPages,
} from "@/lib/extraction/extraction-text";
import { selectExtractionPages } from "@/lib/extraction/select-extraction-pages";

export type OlaSectionAnchor = {
  sectionId: string;
  startIndex: number;
  endIndex: number;
  text: string;
  located: boolean;
};

export type OlaSectionText = {
  sectionId: string;
  text: string;
  located: boolean;
};

/** Operative-clause headings — tried before generic patterns. */
const BODY_CLAUSE_PATTERNS: Record<string, RegExp[]> = {
  parties_and_recitals: [
    /between\s+[\s\S]{10,200}?\s+as\s+(?:Lessor|Seller)/i,
    /AIRCRAFT\s+(?:LEASE|SALE)\s+AGREEMENT/i,
  ],
  definitions_and_interpretation: [
    /CLAUSE\s+1\s+DEFINITIONS AND INTERPRETATION\./i,
    /1\.1\s+Definitions\.\s+/i,
    /ARTICLE\s+1[^a-zA-Z].*DEFINITIONS\./i,
    /^\s*2\.\s*DEFINITIONS/im,
  ],
  governing_law_and_jurisdiction: [
    /\d+\.\d+\s+Governing Law\.\s+This/i,
    /GOVERNING LAW AND JURISDICTION\s*\n?\s*\d+\.\d+/i,
    /CLAUSE\s+\d+\s+FURTHER PROVISIONS\./i,
  ],
  maintenance_reserves: [
    /CLAUSE\s+10\s+MAINTENANCE AND REPAIR\./i,
    /CLAUSE\s+\d+\s+MAINTENANCE(?:\s+AND\s+REPAIR|\s+RESERVES?)\./i,
    /ARTICLE\s+\d+[^a-zA-Z].*MAINTENANCE(?:\s+AND\s+REPAIR|\s+RESERVES?)/i,
  ],
  insurance: [
    /CLAUSE\s+14\s+INSURANCES\./i,
    /CLAUSE\s+\d+\s+INSURANCES?\./i,
    /\d+\.\d+\s+Liability Insurance\./i,
    /ARTICLE\s+\d+[^a-zA-Z].*INSURANCE\./i,
  ],
  redelivery_conditions: [
    /CLAUSE\s+18\s+REDELIVERY\./i,
    /CLAUSE\s+\d+\s+REDELIVERY\./i,
    /\d+\.\d+\s+Redelivery\.\s+On the/i,
  ],
  default_interest: [
    /Default Rate, will be payable/i,
    /\d+\.\d+\s+Default (?:Rate|Interest)\./i,
    /late payment.*interest/i,
  ],
  cape_town_convention: [
    /\d+\.\d+\s+Cape Town Convention\.\s+\([a-z]\)/i,
    /\d+\.\d+\s+Cape Town Convention\./i,
    /CLAUSE\s+\d+[^.\n]{0,50}Cape Town/i,
  ],
  notices: [
    /\d+\.\d+\s+Notices\.\s+(?:\(|All|Any|Each|The)/i,
    /CLAUSE\s+\d+\s+NOTICES\./i,
    /ARTICLE\s+\d+[^a-zA-Z].*NOTICES\./i,
  ],
};

const SECTION_ANCHORS: Array<{ sectionId: string; patterns: RegExp[] }> = [
  {
    sectionId: "parties_and_recitals",
    patterns: [
      /parties and recitals/i,
      /transaction parties/i,
      /between\s+.+\s+\("lessor"\)/i,
      /between\s+.+\s+\("seller"\)/i,
      /ARTICLE\s+1[^a-zA-Z].*(?:parties|recitals)/i,
    ],
  },
  {
    sectionId: "definitions_and_interpretation",
    patterns: [
      /definitions and interpretation/i,
      /^definitions$/im,
      /ARTICLE\s+\d+[^a-zA-Z].*definitions/i,
    ],
  },
  {
    sectionId: "governing_law_and_jurisdiction",
    patterns: [
      /governing law\s*(?:and|&)\s*jurisdiction/i,
      /governing law/i,
      /ARTICLE\s+\d+[^a-zA-Z].*governing law/i,
    ],
  },
  {
    sectionId: "maintenance_reserves",
    patterns: [
      /maintenance reserves?/i,
      /maintenance reserve account/i,
      /maintenance and repair/i,
      /ARTICLE\s+\d+[^a-zA-Z].*maintenance/i,
    ],
  },
  {
    sectionId: "insurance",
    patterns: [
      /^insurances?$/im,
      /^insurance$/im,
      /insurance requirements/i,
      /ARTICLE\s+\d+[^a-zA-Z].*insurance/i,
    ],
  },
  {
    sectionId: "redelivery_conditions",
    patterns: [
      /redelivery conditions?/i,
      /return conditions?/i,
      /ARTICLE\s+\d+[^a-zA-Z].*redelivery/i,
    ],
  },
  {
    sectionId: "default_interest",
    patterns: [
      /default interest/i,
      /default rate/i,
      /late payment interest/i,
      /ARTICLE\s+\d+[^a-zA-Z].*default/i,
    ],
  },
  {
    sectionId: "cape_town_convention",
    patterns: [
      /cape town convention/i,
      /international interest/i,
      /\bidera\b/i,
      /ARTICLE\s+\d+[^a-zA-Z].*cape town/i,
    ],
  },
  {
    sectionId: "notices",
    patterns: [
      /^notices$/im,
      /notices and communications/i,
      /ARTICLE\s+\d+[^a-zA-Z].*notices/i,
    ],
  },
];

const KEYWORD_FALLBACKS: Record<string, RegExp[]> = {
  maintenance_reserves: [
    /reserve rate per/i,
    /supplemental rent/i,
    /maintenance reserve account/i,
  ],
  insurance: [
    /14\.1\s+Obligation to Insure\./i,
    /hull.?all.?risks?/i,
    /liability insurance with respect/i,
    /insured amount/i,
  ],
  redelivery_conditions: [
    /redelivery of the aircraft/i,
    /18\.1\s+Redelivery\./i,
    /return condition standard/i,
  ],
  default_interest: [
    /default rate of interest/i,
    /Default Rate, will be payable/i,
    /overdue amount/i,
  ],
  cape_town_convention: [
    /international registry/i,
    /contracting state/i,
    /irrevocable de-registration/i,
  ],
  notices: [
    /address for notices/i,
    /notice shall be deemed/i,
    /manner of sending notices/i,
  ],
};

const DEFAULT_WINDOW_CHARS = 5000;
const LARGE_SECTION_WINDOW: Record<string, number> = {
  maintenance_reserves: 8000,
  insurance: 7000,
  redelivery_conditions: 8000,
  definitions_and_interpretation: 6000,
  cape_town_convention: 6000,
  governing_law_and_jurisdiction: 3500,
};

function windowSizeForSection(sectionId: string): number {
  return LARGE_SECTION_WINDOW[sectionId] ?? DEFAULT_WINDOW_CHARS;
}

/** True when the match sits in the table-of-contents (page numbers glued to titles). */
function isLikelyTocHit(fullText: string, index: number, matched: string): boolean {
  const ctx = fullText.slice(index, index + Math.max(matched.length + 60, 100));

  // e.g. "12. INSURANCE 26 12.1Liability" (TOC page column)
  if (/\b(?:INSURANCE|NOTICES|REDELIVERY|DEFAULT)\s+\d{1,3}\s+\d+\.\d+/i.test(ctx)) {
    return true;
  }

  // e.g. "CLAUSE 14 INSURANCES57" or "18.1Redelivery73"
  if (/\d+\.\d+[A-Z][a-zA-Z]+?\d{1,3}\b/.test(ctx)) return true;
  if (/CLAUSE\s+\d+\s+[A-Z][A-Z0-9\s]+\d{1,3}\b/.test(ctx) && !/\.\s/.test(ctx.slice(0, 80))) {
    return true;
  }

  // Definition cross-reference: "Cape Town Convention" means ...
  if (/cape town convention/i.test(matched) && /means (?:the )?Convention/i.test(ctx)) {
    return true;
  }
  if (/\bidera\b/i.test(matched) && /means an Irrevocable/i.test(ctx)) {
    return true;
  }

  // Schedule / cross-ref, not operative clause
  if (/SCHEDULE\s+\d+/i.test(ctx.slice(0, 40))) return true;
  if (/return conditions set forth in the Lease Agreement/i.test(ctx)) return true;

  return false;
}

function scoreMatch(
  fullText: string,
  index: number,
  matched: string,
  tocEnd: number
): number {
  let score = 0;
  if (index >= tocEnd) score += 100;
  else score -= 40;

  if (isLikelyTocHit(fullText, index, matched)) score -= 250;

  const ctx = fullText.slice(index, index + 160);
  if (/\d+\.\d+\s+[A-Z][^.\n]{2,50}\.\s+[A-Z]/.test(ctx)) score += 90;
  if (/CLAUSE\s+\d+\s+[A-Z\s]+\.\s+\d+\./.test(ctx)) score += 90;
  if (/GOVERNING LAW AND JURISDICTION\s*\n?\s*\d+\.\d+\s+New York/i.test(ctx)) {
    score += 70;
  }

  score += Math.min(matched.length, 40);
  return score;
}

function detectTocEndIndex(fullText: string): number {
  const toc = /TABLE OF CONTENTS/i.exec(fullText);
  if (!toc) return 0;

  const bodyClauseRe =
    /(?:CLAUSE\s+\d+\s+[A-Z][A-Z\s]+\.\s+\d+\.\d+\s+[A-Z][a-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = bodyClauseRe.exec(fullText)) !== null) {
    if (
      m.index > toc.index + 200 &&
      !isLikelyTocHit(fullText, m.index, m[0])
    ) {
      return Math.max(0, m.index - 400);
    }
  }

  const c1 = fullText.indexOf("CLAUSE 1");
  const c1b = fullText.indexOf("CLAUSE 1", c1 + 20);
  if (c1b > c1 && c1b < 80_000) return Math.max(0, c1b - 300);

  return toc.index + 10_000;
}

function findBestMatch(
  fullText: string,
  patterns: RegExp[],
  tocEnd: number
): { index: number; match: string } | null {
  let best: { index: number; match: string; score: number } | null = null;

  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      const score = scoreMatch(fullText, m.index, m[0], tocEnd);
      if (!best || score > best.score) {
        best = { index: m.index, match: m[0], score };
      }
    }
  }

  if (!best || best.score < -80) return null;
  return { index: best.index, match: best.match };
}

function findNextMajorClause(fullText: string, fromIndex: number): number | null {
  const re = /(?:^|\s)(?:CLAUSE|ARTICLE)\s+\d+\s+[A-Z]/gm;
  re.lastIndex = fromIndex + 80;
  const m = re.exec(fullText);
  return m?.index ?? null;
}

function sliceSectionText(
  fullText: string,
  index: number,
  sectionId: string
): string {
  const windowSize = windowSizeForSection(sectionId);
  const start = Math.max(0, index - 120);
  const nextClause = findNextMajorClause(fullText, index);
  const end = nextClause
    ? Math.min(nextClause, start + windowSize)
    : Math.min(start + windowSize, fullText.length);
  return fullText.slice(start, end).trim();
}

function findSectionStart(
  fullText: string,
  sectionId: string,
  tocEnd: number
): number | null {
  const searchText =
    sectionId === "parties_and_recitals"
      ? fullText.slice(0, 18_000)
      : fullText;
  const searchOffset = fullText.length - searchText.length;

  const specificSubclause: Record<string, RegExp[]> = {
    governing_law_and_jurisdiction: [/\d+\.\d+\s+Governing Law\.\s+This/i],
  };
  const subclause = specificSubclause[sectionId];
  if (subclause) {
    const hit = findBestMatch(searchText, subclause, tocEnd);
    if (hit) return hit.index + searchOffset;
  }

  const bodyPatterns = BODY_CLAUSE_PATTERNS[sectionId];
  if (bodyPatterns) {
    const filtered =
      sectionId === "governing_law_and_jurisdiction"
        ? bodyPatterns.filter((p) => !/FURTHER PROVISIONS/i.test(p.source))
        : bodyPatterns;
    const body = findBestMatch(searchText, filtered, tocEnd);
    if (body) return body.index + searchOffset;
  }

  const anchorDef = SECTION_ANCHORS.find((a) => a.sectionId === sectionId);
  if (anchorDef) {
    const hit = findBestMatch(searchText, anchorDef.patterns, tocEnd);
    if (hit) return hit.index + searchOffset;
  }

  const fallbacks = KEYWORD_FALLBACKS[sectionId];
  if (fallbacks) {
    const hit = findBestMatch(searchText, fallbacks, tocEnd);
    if (hit) return hit.index + searchOffset;
  }

  return null;
}

export function findSectionAnchors(fullText: string): OlaSectionAnchor[] {
  const tocEnd = detectTocEndIndex(fullText);
  const anchors: OlaSectionAnchor[] = [];

  for (const { sectionId } of SECTION_ANCHORS) {
    const index = findSectionStart(fullText, sectionId, tocEnd);
    if (index === null) continue;

    const text = sliceSectionText(fullText, index, sectionId);
    if (!text) continue;

    anchors.push({
      sectionId,
      startIndex: index,
      endIndex: index + text.length,
      text,
      located: true,
    });
  }

  return anchors.sort((a, b) => a.startIndex - b.startIndex);
}

export function getOlaSectionTexts(
  parsed: ParsedDocument
): OlaSectionText[] {
  const fullText = parsed.fullText;
  const knownIds = getOlaSectionIds();
  const byAnchor = new Map(
    findSectionAnchors(fullText).map((a) => [a.sectionId, a])
  );

  return knownIds.map((sectionId) => {
    const anchor = byAnchor.get(sectionId);
    if (anchor?.text) {
      return { sectionId, text: anchor.text, located: true };
    }
    return { sectionId, text: "", located: false };
  });
}

export function buildOlaCorePagesText(parsed: ParsedDocument): string {
  const maxPages = getExtractionMaxPages();
  const scanPages = getExtractionScanPages();

  if (parsed.pages.length > 1) {
    const selected = selectExtractionPages(parsed.pages, maxPages, scanPages);
    const core = selected.map((p) => p.text.trim()).filter(Boolean).join("\n\n");
    if (core) return core;
  }

  const head = parsed.fullText.slice(0, 12_000);
  const tocEnd = detectTocEndIndex(parsed.fullText);
  const gov = findBestMatch(
    parsed.fullText,
    BODY_CLAUSE_PATTERNS.governing_law_and_jurisdiction ??
      [/governing law/i],
    tocEnd
  );

  if (gov && gov.index > 12_000) {
    const snippet = parsed.fullText.slice(gov.index, gov.index + 2_000);
    return `${head}\n\n---\n\n${snippet}`;
  }

  return head;
}
