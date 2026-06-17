import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when value (or a substantial substring) appears in source text. */
export function valueAppearsInSource(value: string, sourceText: string): boolean {
  const normalizedValue = normalizeForMatch(value);
  const normalizedSource = normalizeForMatch(sourceText);

  if (normalizedValue.length < 2) return true;

  if (normalizedSource.includes(normalizedValue)) return true;

  // Allow matching on a meaningful token slice (handles minor OCR/format drift)
  if (normalizedValue.length >= 12) {
    const slice = normalizedValue.slice(0, Math.min(24, normalizedValue.length));
    if (slice.length >= 8 && normalizedSource.includes(slice)) return true;
  }

  // Numeric or short codes (MSN, rates)
  const tokens = normalizedValue.split(/[^a-z0-9./$-]+/).filter((t) => t.length >= 3);
  const significant = tokens.filter((t) => t.length >= 4 || /^\d+$/.test(t));
  if (significant.length > 0) {
    const matched = significant.filter((t) => normalizedSource.includes(t));
    return matched.length >= Math.ceil(significant.length * 0.6);
  }

  return false;
}

function compactAlnum(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function aircraftValueAppearsInSource(value: string, sourceText: string): boolean {
  if (valueAppearsInSource(value, sourceText)) return true;

  const compactValue = compactAlnum(value);
  const compactSource = compactAlnum(sourceText);
  if (compactValue.length >= 5 && compactSource.includes(compactValue)) {
    return true;
  }

  const family = value.match(/\b([AB]\d{3})\b/i)?.[1];
  if (family) {
    const familyLower = family.toLowerCase();
    const tail = compactValue.slice(familyLower.length);
    if (tail.length >= 2 && compactSource.includes(familyLower + tail)) {
      return true;
    }
  }

  return false;
}

/**
 * Drop field values that cannot be found in the source section text (hallucination guard).
 */
export function validateFieldsAgainstSource(
  fields: Record<string, ParsedFieldValue>,
  sourceText: string
): Record<string, ParsedFieldValue> {
  const out: Record<string, ParsedFieldValue> = {};

  for (const [key, field] of Object.entries(fields)) {
    const value = field.value;
    if (value === null || value === undefined || String(value).trim() === "") {
      out[key] = field;
      continue;
    }

    const str = String(value).trim();
    const appearsInSource =
      key === "aircraft"
        ? aircraftValueAppearsInSource(str, sourceText)
        : valueAppearsInSource(str, sourceText);
    if (appearsInSource) {
      out[key] = field;
    } else {
      out[key] = { ...field, value: null, confidence: 0.2 };
    }
  }

  return out;
}
