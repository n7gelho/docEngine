/** Normalize ported LOI text before PDF/DOCX layout. */
export function normalizeExportText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !isPageMarkerLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip embedded PDF page markers like "LOI – Emirate Skyways3". */
export function isPageMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^LOI\s*[–—-]\s*.+\d+\s*$/i.test(trimmed)) return true;
  if (/^LOI\s*[–—-]\s*.+\s+\d+\s*$/i.test(trimmed)) return true;
  if (/^Page\s+\d+\s+of\s+\d+$/i.test(trimmed)) return true;
  return false;
}

export function isGenericSectionLabel(label: string): boolean {
  return /^section\s+\d+$/i.test(label.trim());
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
