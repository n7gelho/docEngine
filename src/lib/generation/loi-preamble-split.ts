import type { DraftFieldSource, LoiDraftField } from "@/lib/generation/loi-draft-types";

/** Split "Dear Sir/Madam…" opening letter from a section that also contains party blocks. */
export function splitOpeningLetterFromSection(text: string): {
  preamble: string | null;
  remainder: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { preamble: null, remainder: text };

  const dearIndex = trimmed.search(/Dear\s+(?:Sir\/Madam|Sirs?|Madam)\b/i);
  if (dearIndex < 0) return { preamble: null, remainder: text };

  const fromDear = trimmed.slice(dearIndex);
  const partyBreak = fromDear.search(
    /\n\s*(?:Lessor|Lessee)\s*(?:\n|$)|\n\s*Transaction parties\b/i
  );

  if (partyBreak < 0) {
    return { preamble: null, remainder: text };
  }

  const preamble = fromDear.slice(0, partyBreak).trim();
  const remainder = (
    trimmed.slice(0, dearIndex) + fromDear.slice(partyBreak)
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (preamble.length < 40) {
    return { preamble: null, remainder: text };
  }

  return { preamble, remainder };
}

function emptyPreambleField(source: DraftFieldSource): LoiDraftField {
  return {
    key: "preamble",
    label: "Preamble",
    value: null,
    source,
    precedentDocumentId: null,
    precedentFilename: null,
    fieldScore: null,
    briefKeys: [],
    editable: true,
  };
}

/**
 * Move embedded opening letters out of body sections into a dedicated preamble field.
 */
export function peelEmbeddedPreambleFromFields(
  fields: LoiDraftField[]
): LoiDraftField[] {
  const existingPreamble = fields.find((field) => field.key === "preamble");
  let preambleText = existingPreamble?.value?.trim() ?? "";
  const bodyFields: LoiDraftField[] = [];

  for (const field of fields) {
    if (field.key === "preamble") continue;

    const raw = field.value?.trim() ?? "";
    if (!raw) {
      bodyFields.push(field);
      continue;
    }

    const { preamble, remainder } = splitOpeningLetterFromSection(raw);
    if (preamble) {
      preambleText = preambleText
        ? `${preambleText}\n\n${preamble}`
        : preamble;
    }

    if (remainder.trim()) {
      bodyFields.push({ ...field, value: remainder });
    } else if (!preamble) {
      bodyFields.push(field);
    }
  }

  if (!preambleText) {
    return fields;
  }

  const preambleField: LoiDraftField = existingPreamble
    ? { ...existingPreamble, value: preambleText }
    : {
        ...emptyPreambleField(
          bodyFields[0]?.source === "user" ? "user" : "precedent"
        ),
        value: preambleText,
        precedentDocumentId: bodyFields[0]?.precedentDocumentId ?? null,
        precedentFilename: bodyFields[0]?.precedentFilename ?? null,
      };

  return [preambleField, ...bodyFields];
}
