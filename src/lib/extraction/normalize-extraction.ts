import { z } from "zod";

export const fieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  rawLabel: z.string().nullable().optional(),
  indicative: z.boolean().optional(),
  source: z
    .object({
      page: z.number().nullable().optional(),
      section: z.string().nullable().optional(),
      snippet: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type ParsedFieldValue = z.infer<typeof fieldValueSchema>;

/** Common LLM typos / alternate keys → canonical field keys */
export const FIELD_KEY_ALIASES: Record<string, string> = {
  inductive_value: "indicative_value",
  indicative_price: "indicative_value",
  purchase_price: "indicative_value",
  serial_number: "msn",
  aircraft_type: "aircraft",
  aircraft_model: "aircraft",
  lease_term: "term",
  lease_type: "transaction_type",
  number_of_aircraft: "aircraft_count",
  aircraft_quantity: "aircraft_count",
  delivery_date: "expected_delivery",
  target_delivery: "expected_delivery",
  target_delivery_date: "expected_delivery",
  security_deposit_amount: "security_deposit",
};

export function aliasFieldKey(key: string): string {
  return FIELD_KEY_ALIASES[key] ?? key;
}

export function normalizeScalarValue(
  value: unknown
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeScalarValue(item)).join("; ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("currency" in obj && "amount" in obj) {
      return `${obj.currency ?? ""} ${obj.amount ?? ""}`.trim();
    }
    const scalarEntries = Object.entries(obj).filter(
      ([, v]) =>
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
    );
    if (scalarEntries.length > 0) {
      return scalarEntries
        .map(([key, v]) => (v === null ? key : `${key}: ${v}`))
        .join("; ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

const SECTION_METADATA_KEYS = new Set([
  "confidence",
  "rawLabel",
  "indicative",
  "source",
]);

function isSourceShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => key === "page" || key === "section" || key === "snippet")
  );
}

export function normalizeFieldValue(raw: unknown): ParsedFieldValue {
  if (raw === null || raw === undefined) {
    return { value: null };
  }
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return { value: raw, confidence: raw === null || raw === "" ? 0.3 : 0.75 };
  }
  if (typeof raw !== "object") {
    return { value: String(raw), confidence: 0.5 };
  }

  const obj = { ...(raw as Record<string, unknown>) };

  if (!("value" in obj)) {
    if (isSourceShape(obj)) {
      return normalizeFieldValue({ value: null, source: obj });
    }

    const sourceKeys = ["page", "section", "snippet"] as const;
    if (sourceKeys.some((key) => key in obj)) {
      const source: Record<string, unknown> = {};
      for (const key of sourceKeys) {
        if (key in obj) {
          source[key] = obj[key];
          delete obj[key];
        }
      }
      obj.source = source;
    }

    if (
      "confidence" in obj ||
      "rawLabel" in obj ||
      "indicative" in obj ||
      Object.keys(obj).length === 0
    ) {
      obj.value = null;
    } else {
      obj.value = normalizeScalarValue(obj);
      delete (obj as Record<string, unknown>).confidence;
      return {
        value: obj.value as string | number | boolean | null,
        confidence: 0.75,
      };
    }
  }

  if ("value" in obj) {
    obj.value = normalizeScalarValue(obj.value);
  }
  if (obj.confidence === null) delete obj.confidence;
  if (obj.indicative === null) delete obj.indicative;
  if (obj.rawLabel === null) delete obj.rawLabel;

  if (obj.source && typeof obj.source === "object") {
    const source = { ...(obj.source as Record<string, unknown>) };
    for (const key of ["page", "section", "snippet"] as const) {
      if (source[key] === null) delete source[key];
    }
    obj.source = Object.keys(source).length > 0 ? source : undefined;
  }

  const parsed = fieldValueSchema.safeParse(obj);
  if (parsed.success) {
    const fv = parsed.data;
    if (
      fv.confidence === undefined &&
      fv.value !== null &&
      fv.value !== ""
    ) {
      return { ...fv, confidence: 0.75 };
    }
    return fv;
  }

  return { value: normalizeScalarValue(obj), confidence: 0.5 };
}

export function normalizeFieldMap(
  fields: Record<string, unknown>
): Record<string, ParsedFieldValue> {
  const result: Record<string, ParsedFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "dealType" || key === "documentType" || key === "sections") {
      continue;
    }
    result[aliasFieldKey(key)] = normalizeFieldValue(value);
  }
  return result;
}

function normalizeSectionFields(
  sectionFields: Record<string, unknown>,
  primaryFieldKey?: string
): Record<string, ParsedFieldValue> {
  const orphaned: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(sectionFields)) {
    if (SECTION_METADATA_KEYS.has(key)) {
      orphaned[key] = value;
      continue;
    }
    if (key === "source" && isSourceShape(value)) {
      orphaned.source = value;
      continue;
    }
    fields[key] = value;
  }

  if (Object.keys(orphaned).length > 0) {
    const targetKey =
      Object.keys(fields)[0] ?? primaryFieldKey ?? "_extracted";
    const existing = fields[targetKey];
    fields[targetKey] = {
      ...(typeof existing === "object" && existing !== null
        ? (existing as Record<string, unknown>)
        : { value: existing ?? null }),
      ...orphaned,
    };
  }

  return normalizeFieldMap(fields);
}

export function normalizeExtractionPayload(
  raw: unknown,
  options?: { primaryFieldKeyBySection?: Record<string, string> }
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid extraction JSON");
  }

  const obj = { ...(raw as Record<string, unknown>) };

  if (obj.fields && typeof obj.fields === "object") {
    obj.fields = normalizeFieldMap(obj.fields as Record<string, unknown>);
  }

  if (obj.sections && typeof obj.sections === "object") {
    obj.sections = Object.fromEntries(
      Object.entries(obj.sections as Record<string, unknown>).map(
        ([sectionId, sectionFields]) => [
          sectionId,
          typeof sectionFields === "object" && sectionFields !== null
            ? normalizeSectionFields(
                sectionFields as Record<string, unknown>,
                options?.primaryFieldKeyBySection?.[sectionId]
              )
            : sectionFields,
        ]
      )
    );
  }

  return obj;
}

/** Parse a flat section response: { "field_a": "value", "field_b": null } */
export function parseFlatSectionFields(
  raw: unknown,
  allowedKeys?: string[]
): Record<string, ParsedFieldValue> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid section JSON");
  }

  const obj = raw as Record<string, unknown>;
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const fields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "dealType" || key === "documentType" || key === "sections") {
      continue;
    }
    const aliased = aliasFieldKey(key);
    if (allowed && !allowed.has(aliased)) continue;
    fields[aliased] = value;
  }

  const result = normalizeFieldMap(fields);

  if (allowedKeys) {
    for (const key of allowedKeys) {
      if (!result[key]) {
        result[key] = { value: null, confidence: 0.3 };
      }
    }
  }

  return result;
}
