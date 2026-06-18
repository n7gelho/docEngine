import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import { isValidLoiSectionTitle } from "@/lib/generation/export-loi-normalize";
import { splitTextIntoSections } from "@/lib/extraction/select-extraction-pages";

export type ExtractedLoiSection = {
  id: string;
  index: number;
  title: string;
  bodyText: string;
  /** Title line plus body, as it would appear in the exported LOI. */
  fullText: string;
  briefKeys: DealParameterKey[];
};

const SECTION_BRIEF_HINTS: Array<{
  pattern: RegExp;
  keys: DealParameterKey[];
}> = [
  {
    pattern: /parties|lessor|lessee|counterpart|between/i,
    keys: ["counterparty"],
  },
  {
    pattern: /aircraft|equipment|asset|msn|registration/i,
    keys: ["aircraft", "aircraft_count"],
  },
  {
    pattern: /transaction|lease type|operating lease|dry lease|wet lease/i,
    keys: ["transaction_type"],
  },
  {
    pattern: /term(?!ination)|duration|period of lease/i,
    keys: ["lease_term"],
  },
  {
    pattern: /rent|rental|basic rent|monthly/i,
    keys: ["monthly_rent"],
  },
  {
    pattern: /security deposit|deposit/i,
    keys: ["security_deposit"],
  },
  {
    pattern: /maintenance|reserve/i,
    keys: ["maintenance_reserve"],
  },
  { pattern: /insurance/i, keys: ["insurance"] },
  {
    pattern: /delivery|redelivery|acceptance/i,
    keys: ["expected_delivery"],
  },
  {
    pattern: /governing law|jurisdiction|further provisions/i,
    keys: [],
  },
  {
    pattern: /conditions precedent|effectiveness|cp\b/i,
    keys: [],
  },
];

function slugify(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return slug ? `section_${index}_${slug}` : `section_${index}`;
}

function inferBriefKeys(title: string, bodyText: string): DealParameterKey[] {
  const combined = `${title}\n${bodyText.slice(0, 1200)}`;
  const keys = new Set<DealParameterKey>();

  for (const hint of SECTION_BRIEF_HINTS) {
    if (hint.pattern.test(combined)) {
      for (const key of hint.keys) keys.add(key);
    }
  }

  return Array.from(keys);
}

const INFERRED_SECTION_RULES: Array<{
  test: (opening: string, firstLine: string) => boolean;
  title: string;
}> = [
  {
    test: (_o, first) => /^(?:appendix|schedule|annex)\s+/i.test(first),
    title: "", // use first line as title
  },
  {
    test: (opening) => isTransactionPartiesOpening(opening),
    title: "Transaction parties",
  },
  {
    test: (opening) => /conditions precedent|effectiveness/i.test(opening),
    title: "Conditions precedent",
  },
  {
    test: (opening) => /governing law|jurisdiction/i.test(opening),
    title: "Governing law and jurisdiction",
  },
  {
    test: (opening, first) =>
      /^security deposit$/i.test(first) || /security deposit/i.test(opening.slice(0, 280)),
    title: "Security deposit",
  },
  {
    test: (opening, first) =>
      /^rent$/i.test(first) ||
      (/\brent\b/i.test(opening.slice(0, 200)) && /monthly|advance/i.test(opening)),
    title: "Rent",
  },
  {
    test: (opening, first) =>
      /^maintenance payments?$/i.test(first) || /maintenance payments/i.test(opening.slice(0, 320)),
    title: "Maintenance payments",
  },
  {
    test: (opening, first) =>
      /^insurance$/i.test(first) || /^insurance\b/i.test(opening.slice(0, 120)),
    title: "Insurance",
  },
  {
    test: (opening) => /redelivery conditions|redelivery location/i.test(opening),
    title: "Redelivery",
  },
  {
    test: (opening, first) =>
      /^aircraft\b/i.test(first) ||
      (/airframe/i.test(opening) && /engines?/i.test(opening) && /msn/i.test(opening)),
    title: "Aircraft and delivery",
  },
  {
    test: (opening) => /lease term|lease period|\b\d+\s+months\b/i.test(opening.slice(0, 200)),
    title: "Lease term",
  },
  {
    test: (opening) => /inspection and delivery|delivery inspection/i.test(opening),
    title: "Inspection and delivery",
  },
  {
    test: (opening) => /validity of terms|valid for acceptance/i.test(opening),
    title: "Validity of terms",
  },
];

function openingSample(bodyText: string): { opening: string; firstLine: string } {
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? "";
  const opening = lines.slice(0, 8).join("\n").slice(0, 600);
  return { opening, firstLine };
}

function isTransactionPartiesOpening(opening: string): boolean {
  const lines = opening.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasLessor = lines.some((line) => isPartyLabelLine(line, "lessor"));
  const hasLessee = lines.some((line) => isPartyLabelLine(line, "lessee"));
  return hasLessor && hasLessee;
}

function isPartyLabelLine(line: string, party: "lessor" | "lessee"): boolean {
  const re =
    party === "lessor"
      ? /^lessor\s*(?:[.:]\s*)?$/i
      : /^lessee\s*(?:[.:]\s*)?$/i;
  return re.test(line.trim());
}

function inferSectionTitle(bodyText: string, index: number): string {
  const { opening, firstLine } = openingSample(bodyText);

  if (/^(?:appendix|schedule|annex)\s+/i.test(firstLine)) {
    return firstLine.slice(0, 100);
  }

  for (const rule of INFERRED_SECTION_RULES) {
    if (!rule.title) continue;
    if (rule.test(opening, firstLine)) return rule.title;
  }

  return `Section ${index + 1}`;
}

/** Infer a semantic section title from opening lines when extraction picked a bad heading. */
export function inferLoiSectionTitle(bodyText: string, index = 0): string {
  return inferSectionTitle(bodyText, index);
}

function parseSectionBlock(text: string, index: number): ExtractedLoiSection | null {
  const trimmed = text.trim();
  if (trimmed.length < 40) return null;

  const lines = trimmed.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const firstLineIsTitle = isValidLoiSectionTitle(firstLine);
  const title = firstLineIsTitle ? firstLine : inferSectionTitle(trimmed, index);
  const bodyText = firstLineIsTitle ? lines.slice(1).join("\n").trim() : trimmed;
  const fullText = firstLineIsTitle ? trimmed : `${title}\n\n${bodyText}`;

  return {
    id: slugify(title, index),
    index,
    title,
    bodyText,
    fullText,
    briefKeys: inferBriefKeys(title, bodyText),
  };
}

function extractPreamble(fullText: string, firstSectionStart: number): ExtractedLoiSection | null {
  const preamble = fullText.slice(0, firstSectionStart).trim();
  if (preamble.length < 80) return null;

  const lines = preamble.split("\n").filter((l) => l.trim());
  const title =
    lines.find((l) => /letter of intent|\bloi\b/i.test(l))?.trim() ??
    lines[0]?.trim() ??
    "Preamble";

  return {
    id: "preamble",
    index: -1,
    title,
    bodyText: preamble,
    fullText: preamble,
    briefKeys: inferBriefKeys(title, preamble),
  };
}

/** Split an LOI full_text into section slots for template derivation and porting. */
export function extractLoiSections(fullText: string | null | undefined): ExtractedLoiSection[] {
  if (!fullText?.trim()) return [];

  const stripped = stripClosingFromText(fullText);
  const loiBlocks = splitLoiByHeadings(stripped);
  const blocks =
    loiBlocks.length >= 2 ? loiBlocks : splitTextIntoSections(stripped);
  const sections: ExtractedLoiSection[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const parsed = parseSectionBlock(blocks[i].text, i);
    if (parsed) sections.push(parsed);
  }

  if (sections.length === 0) {
    const fallback = parseSectionBlock(fullText, 0);
    return fallback ? [fallback] : [];
  }

  const firstBlockStart = fullText.indexOf(blocks[0].text.slice(0, 60));
  if (firstBlockStart > 80) {
    const preamble = extractPreamble(fullText, firstBlockStart);
    if (preamble) sections.unshift(preamble);
  }

  return sections.map((section, index) => ({
    ...section,
    index,
    id: section.id === "preamble" ? "preamble" : slugify(section.title, index),
  }));
}

/** Letterhead / title block before the first operative section in a template LOI. */
export function extractTemplatePreamble(
  fullText: string | null | undefined
): string | null {
  if (!fullText?.trim()) return null;
  const sections = extractLoiSections(fullText);
  const preamble = sections.find((s) => s.id === "preamble");
  return preamble?.fullText.trim() ?? null;
}

const CLOSING_BLOCK_START =
  /^(?:yours?\s+(?:faithfully|sincerely)|sincerely|respectfully|for\s+and\s+on\s+behalf|signed(?:\s+by)?|signature|executed\s+(?:as\s+a\s+)?deed|in\s+witness\s+whereof|acknowledged\s+and\s+accepted|authorised\s+signatory|authorized\s+signatory)/i;

const CLOSING_BLOCK_LINE =
  /^(?:name|title|position|date|witness|director|by)\s*:/i;

/** Signature / closing block at the end of a template LOI (not a body section). */
export function extractTemplateClosingBlock(
  fullText: string | null | undefined
): string | null {
  if (!fullText?.trim()) return null;

  const lines = fullText.split("\n");
  let startIndex = -1;

  for (let i = Math.max(0, lines.length - 80); i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) continue;
    if (CLOSING_BLOCK_START.test(trimmed) || CLOSING_BLOCK_LINE.test(trimmed)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex < 0) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
      const trimmed = lines[i]?.trim() ?? "";
      if (/^_{3,}$/.test(trimmed) || /^[\s\-–—]{8,}$/.test(trimmed)) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex < 0) return null;

  const closing = lines.slice(startIndex).join("\n").trim();
  return closing.length >= 20 ? closing : null;
}

function stripClosingFromText(fullText: string): string {
  const closing = extractTemplateClosingBlock(fullText);
  if (!closing) return fullText;
  const idx = fullText.lastIndexOf(closing);
  if (idx < 0) return fullText;
  return fullText.slice(0, idx).trimEnd();
}

function isLikelyHeadingLine(trimmed: string, bodyLen: number): boolean {
  if (bodyLen < 40) return false;
  return isValidLoiSectionTitle(trimmed);
}

/** LOI-specific heading split before generic window fallback. */
function splitLoiByHeadings(fullText: string): Array<{ text: string }> {
  const withoutClosing = stripClosingFromText(fullText);
  const lines = withoutClosing.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentHeading: string | undefined;

  function flush() {
    const body = current.join("\n").trim();
    if (body.length < 40) return;
    chunks.push(currentHeading ? `${currentHeading}\n${body}` : body);
    current = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const bodyLen = current.join("\n").trim().length;
    if (isLikelyHeadingLine(trimmed, bodyLen)) {
      flush();
      currentHeading = trimmed;
    } else {
      current.push(line);
    }
  }
  flush();

  return chunks.map((text) => ({ text }));
}

export function matchSectionByTitle(
  templateTitle: string,
  candidateSections: ExtractedLoiSection[]
): ExtractedLoiSection | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const target = norm(templateTitle);
  if (!target) return null;

  const targetSectionNum = parseGenericSectionNumber(target);

  let best: { section: ExtractedLoiSection; score: number } | null = null;

  for (const section of candidateSections) {
    const title = norm(section.title);
    if (!title) continue;

    const candidateSectionNum = parseGenericSectionNumber(title);
    if (targetSectionNum !== null && candidateSectionNum !== null) {
      const score = targetSectionNum === candidateSectionNum ? 1 : 0;
      if (!best || score > best.score) {
        best = { section, score };
      }
      continue;
    }

    let score = 0;
    if (title === target) score = 1;
    else if (title.includes(target) || target.includes(title)) score = 0.85;
    else {
      const stop = new Set(["section", "schedule", "article", "clause", "part"]);
      const targetTokens = new Set(
        target.split(" ").filter((t) => t.length > 2 && !stop.has(t))
      );
      const titleTokens = title
        .split(" ")
        .filter((t) => t.length > 2 && !stop.has(t));
      if (targetTokens.size === 0 || titleTokens.length === 0) {
        score = 0;
      } else {
        let shared = 0;
        for (const token of titleTokens) {
          if (targetTokens.has(token)) shared++;
        }
        score = shared / Math.max(titleTokens.length, targetTokens.size);
      }
    }

    if (!best || score > best.score) {
      best = { section, score };
    }
  }

  return best && best.score >= 0.65 ? best.section : null;
}

function parseGenericSectionNumber(normalizedTitle: string): number | null {
  const match = normalizedTitle.match(/^section (\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Resolve which donor section supplies a template slot. */
export function resolveDonorSection(
  templateSection: ExtractedLoiSection,
  donorSections: ExtractedLoiSection[],
  options?: { preferIndex?: boolean }
): ExtractedLoiSection | null {
  if (options?.preferIndex) {
    const aligned = donorSections[templateSection.index];
    if (aligned?.fullText.trim()) return aligned;
  }

  const byTitle = matchSectionByTitle(templateSection.title, donorSections);
  if (byTitle?.fullText.trim()) return byTitle;

  const byIndex = donorSections[templateSection.index];
  if (byIndex?.fullText.trim()) return byIndex;

  return null;
}

export function donorSectionKey(
  precedentId: string,
  section: ExtractedLoiSection
): string {
  return `${precedentId}:${section.index}:${section.id}`;
}

export function blankSectionTemplate(section: ExtractedLoiSection): string {
  if (section.bodyText.trim().length < 40) return "";

  return section.bodyText
    .replace(/[A-Z][A-Za-z0-9&.,'()\-/\s]{2,40}(?:\s+Ltd\.?|\s+LLC|\s+Inc\.?|\s+Corp\.?)/g, "[Party]")
    .replace(/\bUSD\s*[\d,]+(?:\.\d+)?/gi, "[Amount]")
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, "[Amount]")
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*\(\d+\)\b/gi, "[Count]")
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, "[Date]")
    .replace(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi, "[Date]");
}
