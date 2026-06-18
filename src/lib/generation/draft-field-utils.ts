import type {
  LoiDraftContent,
  LoiDraftField,
  LoiDraftSection,
} from "@/lib/generation/loi-draft-types";

export function collectFieldKeys(content: LoiDraftContent): Set<string> {
  const keys = new Set<string>();
  for (const section of content.sections) {
    for (const field of section.fields) {
      keys.add(field.key);
    }
  }
  return keys;
}

function slugifyFieldKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "section";
}

export function uniqueFieldKey(
  label: string,
  existingKeys: Set<string>
): string {
  let key = slugifyFieldKey(label);
  if (!existingKeys.has(key)) return key;
  let index = 2;
  while (existingKeys.has(`${key}_${index}`)) {
    index++;
  }
  return `${key}_${index}`;
}

export function primaryBodySection(
  content: LoiDraftContent
): LoiDraftSection | null {
  return (
    content.sections.find((section) => section.id === "document_body") ??
    content.sections[0] ??
    null
  );
}

export function createUserField(
  label: string,
  options?: { value?: string | null; key?: string; existingKeys?: Set<string> }
): LoiDraftField {
  const keys = options?.existingKeys ?? new Set<string>();
  const key =
    options?.key ??
    uniqueFieldKey(label, keys);

  return {
    key,
    label: label.trim() || "New section",
    value: options?.value?.trim() || null,
    source: "user",
    precedentDocumentId: null,
    precedentFilename: null,
    fieldScore: null,
    briefKeys: [],
    editable: true,
  };
}

export function removeFieldByKey(
  content: LoiDraftContent,
  fieldKey: string
): boolean {
  for (const section of content.sections) {
    const index = section.fields.findIndex((field) => field.key === fieldKey);
    if (index >= 0) {
      section.fields.splice(index, 1);
      return true;
    }
  }
  return false;
}
