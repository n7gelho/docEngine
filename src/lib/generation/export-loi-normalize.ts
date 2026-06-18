/** Remove LOI Fake/Real markers embedded in lines (not only standalone). */
export function stripInlinePageMarkers(text: string): string {
  return text
    .replace(/\bLOI\s+Fake\s*\d*/gi, " ")
    .replace(/\bLOI\s+Real\s*/gi, " ");
}

/** Normalize ported LOI text before PDF/DOCX layout. */
export function normalizeExportText(text: string): string {
  const stripped = stripInlinePageMarkers(text);
  const repaired = repairGarbledDayCounts(stripped);
  return repaired
    .replace(/\r\n/g, "\n")
    .replace(/\t+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !isPageMarkerLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fix reconcile-damaged day counts like "14,050,000 business days" → "14 business days". */
export function repairGarbledDayCounts(text: string): string {
  return text.replace(
    /\b(\d{1,3}(?:,\d{3})+)\s+(business\s+)?days\b/gi,
    (full, numStr: string, business?: string) => {
      const total = Number(numStr.replace(/,/g, ""));
      if (!Number.isFinite(total) || total <= 365) return full;
      const lead = numStr.match(/^(\d{1,3}),/)?.[1];
      if (lead && Number(lead) <= 365) {
        const biz = business?.trim() ? `${business.trim()} ` : "";
        return `${lead} ${biz}days`;
      }
      return full;
    }
  );
}

/** Strip embedded PDF page markers like "LOI – Emirate Skyways3" or "LOI Fake 1". */
export function isPageMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^LOI\s+Fake\s*\d*\s*$/i.test(trimmed)) return true;
  if (/^LOI\s+Real\s*$/i.test(trimmed)) return true;
  if (/^LOI\s*[–—-]\s*.+\d+\s*$/i.test(trimmed)) return true;
  if (/^LOI\s*[–—-]\s*.+\s+\d+\s*$/i.test(trimmed)) return true;
  if (/^LOI\s+\S+(?:\s+\S+)*\s+\d+\s*$/i.test(trimmed)) return true;
  if (/^LOI\s+Fake\s*\d+\s*$/i.test(trimmed)) return true;
  if (/^Page\s+\d+\s+of\s+\d+$/i.test(trimmed)) return true;
  return false;
}

export function isGenericSectionLabel(label: string): boolean {
  return /^section\s+\d+$/i.test(label.trim());
}

/** Operative LOI clause text misread as a heading (e.g. "Lessee shall pay rent…"). */
export function isOperativeProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (
    /\b(?:shall|will|must|may|agrees?|undertakes?|acknowledges?|represents?|warrants?|is\s+responsible|are\s+responsible|has\s+agreed|have\s+agreed|hereby|notwithstanding)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/[.!?;:]$/.test(trimmed) && trimmed.split(/\s+/).length >= 5) {
    return true;
  }
  return false;
}

/** Company / party name lines that are not section titles. */
export function isPartyNameLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^transaction parties$/i.test(trimmed)) return false;
  if (
    /\b(?:limited|ltd\.?|llc|inc\.?|corp\.?|plc|gmbh|airways|airlines|aviation|holdings)\b/i.test(
      trimmed
    ) &&
    !/^\d+(?:\.\d+)*\.?\s+/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/** True when a line is a genuine LOI section title (short label or numbered heading). */
export function isValidLoiSectionTitle(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length >= 100) return false;
  if (isPageMarkerLine(trimmed)) return false;
  if (isGenericSectionLabel(trimmed)) return false;
  if (isOperativeProseLine(trimmed)) return false;
  if (isPartyNameLine(trimmed)) return false;
  if (/^letter of intent$/i.test(trimmed)) return false;
  if (/^re:\s/i.test(trimmed)) return false;
  if (/^dear\s+/i.test(trimmed)) return false;
  if (/^(?:appendix|schedule|annex|part)\s+/i.test(trimmed)) return true;
  if (/^\d+(?:\.\d+)*\.?\s+\S/.test(trimmed)) return true;

  const words = trimmed.split(/\s+/).length;
  if (words > 8) return false;

  if (/^[A-Z0-9][A-Z0-9\s\-/&().,'"]+$/.test(trimmed) && words <= 8) {
    return true;
  }

  if (words <= 5 && /^[A-Z]/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return true;
  }

  return false;
}

const SCHEDULE_HEADER = [
  "Airframe",
  "Engines",
  "MSN",
  "Delivery Quarter",
  "Scheduled Delivery",
];

/** Parse one mashed Boeing schedule row (no header). */
export function tryParseMashedBoeingScheduleRow(line: string): string[] | null {
  const match = line
    .trim()
    .match(
      /Boeing\s+(\d{3}-\d+)([A-Z]{2}\d+[A-Z0-9]*?)(\d{3,})(Q\d)\s*(.*)$/i
    );
  if (!match) return null;
  return [
    `Boeing ${match[1]}`,
    match[2],
    match[3],
    match[4],
    match[5].trim(),
  ];
}

/** Parse mashed Boeing schedule rows from PDF text (no column spaces). */
export function extractMashedScheduleRows(text: string): string[][] | null {
  const pattern =
    /Boeing\s+(\d{3}-\d+)([A-Z]{2}\d+[A-Z0-9]*?)(\d{3,})(Q\d)\s*/gi;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return null;

  const rows: string[][] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    const delivery = text.slice(start, end).replace(/\s+/g, " ").trim();
    rows.push([
      `Boeing ${match[1]}`,
      match[2],
      match[3],
      match[4],
      delivery,
    ]);
  }

  return [SCHEDULE_HEADER, ...rows];
}

/** Short topic line inside a section body (Insurance, Taxes, Part B, etc.). */
export function isLoiSubheadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 70) return false;
  if (isOperativeProseLine(trimmed)) return false;
  if (isPartyNameLine(trimmed)) return false;
  if (isScheduleHeaderFragment(trimmed)) return false;
  if (/^(?:appendix|schedule|section)\s+/i.test(trimmed)) return true;
  if (/^part\s+[ab]$/i.test(trimmed)) return true;

  const words = trimmed.split(/\s+/).length;
  if (words === 1) {
    return /^(?:insurance|taxes|registration|rent|sanctions|timetable|enforceability|payments|configuration|paint|weights|repairs|maintenance|redelivery|confidentiality|documentation)$/i.test(
      trimmed
    );
  }

  if (
    /^(?:insurance|taxes|registration|subleasing|maintenance payments|redelivery conditions|redelivery location|confidentiality|documentation|sanctions|timetable|enforceability|payments|airframe|engines|weights|paint|configuration|landing\s+gear|interior\s+configuration|net\s+lease|no\s+brokers|validity\s+of\s+terms|assignment\/financing|transaction\s+expenses|export\s+and\s+certificate\s+of\s+airworthiness|airworthiness\s+directives|repairs|components\/parts|aircraft documents|lease period|rolls royce)/i.test(
      trimmed
    )
  ) {
    return true;
  }

  return words >= 2 && words <= 5 && isValidLoiSectionTitle(trimmed);
}

/** Table column labels split onto separate lines by PDF extraction. */
export function isScheduleHeaderFragment(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (
    /^(?:airframe|engines?|msn|scheduled|delivery|month|quarter|dates?)$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (
    /^airframe\s+engines?\s+msn/i.test(trimmed) &&
    !/\b(?:shall|the|lessee|lessor)\b/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function compactText(text: string): string {
  return normalizeExportText(text).toLowerCase().replace(/\s+/g, "");
}

export { compactText };

/** True when a body block largely repeats the preamble opening. */
export function blockOverlapsPreamble(
  blockText: string,
  preamble: string
): boolean {
  const block = compactText(blockText);
  const pre = compactText(preamble);
  if (!block || !pre || block.length < 40) return false;

  const openLen = Math.min(120, pre.length, block.length);
  if (openLen >= 40 && block.slice(0, openLen) === pre.slice(0, openLen)) {
    return true;
  }

  if (pre.length >= 80 && block.startsWith(pre.slice(0, 80))) {
    return true;
  }

  const preSample = pre.slice(0, Math.min(500, pre.length));
  if (preSample.length >= 100 && block.includes(preSample)) {
    return true;
  }

  const compareLen = Math.min(400, pre.length, block.length);
  if (compareLen < 80) return false;

  const blockPrefix = block.slice(0, compareLen);
  const prePrefix = pre.slice(0, compareLen);
  if (blockPrefix === prePrefix) return true;

  if (block.startsWith(prePrefix.slice(0, Math.min(250, prePrefix.length)))) {
    return true;
  }

  if (pre.includes(block.slice(0, Math.min(200, block.length)))) {
    return true;
  }

  return false;
}

/** True when block B repeats content already present in prior text. */
export function blockOverlapsBlock(blockText: string, priorText: string): boolean {
  const a = compactText(priorText);
  const b = compactText(blockText);
  if (!a || !b || b.length < 60) return false;

  const prefix = b.slice(0, Math.min(220, b.length));
  if (prefix.length >= 50 && a.includes(prefix)) return true;

  if (b.startsWith(a.slice(0, Math.min(200, a.length)))) return true;

  if (a.length >= 120 && b.length >= 120 && a.includes(b.slice(0, 120))) {
    return true;
  }

  return false;
}

/** Detect aircraft schedule / tabular rows with single-space columns. */
export function tryParseScheduleRow(line: string): string[] | null {
  const trimmed = line.trim();

  const aircraftRow = trimmed.match(
    /^([A-Z]?\d{3,}-\d+)\s+(\S+)\s+(\d{3,})\s+(Q\d)\s+(\d{4}(?:\s+\(.*\))?)/i
  );
  if (aircraftRow) {
    return [
      aircraftRow[1],
      aircraftRow[2],
      aircraftRow[3],
      aircraftRow[4],
      aircraftRow[5],
    ];
  }

  const mashedBoeing = trimmed.match(
    /^Boeing\s+(\d{3}-\d+)([A-Z]{2}\d+[A-Z0-9]*?)(\d{3,})(Q\d)\s*(.+)$/i
  );
  if (mashedBoeing) {
    return [
      `Boeing ${mashedBoeing[1]}`,
      mashedBoeing[2],
      mashedBoeing[3],
      mashedBoeing[4],
      mashedBoeing[5].trim(),
    ];
  }

  const mashedRow = trimmed.match(
    /^([A-Z]?\d{3,}-\d+)([A-Z][A-Z0-9-]+)(\d{3,})(Q\d)\s*(.+)$/i
  );
  if (mashedRow) {
    return [
      mashedRow[1],
      mashedRow[2],
      mashedRow[3],
      mashedRow[4],
      mashedRow[5].trim(),
    ];
  }

  const headerLike =
    /airframe/i.test(trimmed) &&
    /engines?/i.test(trimmed) &&
    /msn/i.test(trimmed);
  if (headerLike) {
    if (!/\s{2,}/.test(trimmed) && trimmed.length < 80) {
      return [
        "Airframe",
        "Engines",
        "MSN",
        "Scheduled Delivery Month",
      ];
    }
    return [
      "Airframe",
      "Engines",
      "MSN",
      "Scheduled Delivery Month",
    ];
  }

  return null;
}

/** Sanitize text for pdf-lib StandardFonts (WinAnsi). */
export function sanitizeForPdfLib(text: string): string {
  return text
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}
