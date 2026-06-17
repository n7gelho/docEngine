import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
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

function parseSectionBlock(text: string, index: number): ExtractedLoiSection | null {
  const trimmed = text.trim();
  if (trimmed.length < 40) return null;

  const lines = trimmed.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const headingPattern =
    /^(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9\s\-\/&(),.'"]{2,}$/;
  const isHeading =
    firstLine.length > 0 &&
    firstLine.length < 120 &&
    (headingPattern.test(firstLine) ||
      /^TRANSACTION PARTIES$/i.test(firstLine) ||
      /^LETTER OF INTENT$/i.test(firstLine) ||
      /^SCHEDULE\s+\d+/i.test(firstLine));

  const title = isHeading ? firstLine : `Section ${index + 1}`;
  const bodyText = isHeading ? lines.slice(1).join("\n").trim() : trimmed;
  const fullText = isHeading ? trimmed : `${title}\n\n${bodyText}`;

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

  const loiBlocks = splitLoiByHeadings(fullText);
  const blocks =
    loiBlocks.length >= 2 ? loiBlocks : splitTextIntoSections(fullText);
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

const LOI_HEADING_LINE =
  /^(?:(?:\d+(?:\.\d+)*\.?\s+)|(?:CLAUSE|ARTICLE|SCHEDULE)\s+\d+(?:\.\d+)?[.:]?\s+)?(?:[A-Z][A-Z0-9\s\-\/&(),.'"]{3,}|[A-Z][a-z]+(?:\s+[A-Za-z]+){1,8})$/;

/** LOI-specific heading split before generic window fallback. */
function splitLoiByHeadings(fullText: string): Array<{ text: string }> {
  const lines = fullText.split("\n");
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
    if (
      trimmed &&
      trimmed.length < 120 &&
      LOI_HEADING_LINE.test(trimmed) &&
      bodyLen > 100
    ) {
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
