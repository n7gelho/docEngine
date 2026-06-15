import { getOlaProfile } from "@/lib/profiles/schema-registry";

export const EXTRACTION_SYSTEM_PROMPT =
  "Extract structured aircraft deal metadata. Respond with valid JSON only. Use null for fields with no clear evidence. Do not invent values. You MUST include every requested field key in your JSON response.";

export const CLASSIFICATION_SYSTEM_PROMPT =
  "Classify aircraft deal documents. Respond with valid JSON only.";

export function buildClassificationPrompt(text: string): string {
  return `You are an expert in aircraft deal documents (LOIs and definitive agreements).

Classify the document from the filename and header text below.

documentType rules:
- "LOI": letter of intent, heads of terms, term sheet, indicative/non-binding offer
- "OLA": operating lease agreement, aircraft lease agreement, purchase/sale agreement, definitive contract with numbered clauses, "(as Lessor)" / "(as Lessee)" party blocks

dealType rules:
- "LEASE": lessor/lessee, operating lease, lease agreement
- "PURCHASE": seller/buyer/purchaser, sale and purchase, aircraft purchase agreement

confidence:
- "high": clear title or multiple strong signals agree
- "medium": reasonable signals but some ambiguity
- "low": weak or conflicting signals

Return JSON:
{
  "dealType": "LEASE" | "PURCHASE",
  "documentType": "LOI" | "OLA",
  "confidence": "high" | "medium" | "low",
  "signals": ["short phrases that support your classification"]
}

INPUT:
${text}`;
}

export function buildLoiExtractionPrompt(
  text: string,
  dealType: "LEASE" | "PURCHASE"
): string {
  if (dealType === "LEASE") {
    return `You are an expert in aircraft deal LOI (Letter of Intent) documents.

dealType must be "LEASE". documentType must be "LOI".

Extract these fields from the document text only. Use null when not clearly stated — do not guess.
- lessor: the lessor entity name
- lessee: the lessee entity name
- aircraft, msn, term, jurisdiction, governing_law, indicative_value

IMPORTANT: Return ALL field keys below. Use null for missing values.

Return flat JSON — string or null values only:
{
  "dealType": "LEASE",
  "documentType": "LOI",
  "fields": {
    "lessor": null,
    "lessee": null,
    "aircraft": null,
    "msn": null,
    "term": null,
    "jurisdiction": null,
    "governing_law": null,
    "indicative_value": null
  }
}

DOCUMENT TEXT:
${text}`;
  }

  return `You are an expert in aircraft deal LOI (Letter of Intent) documents.

dealType must be "PURCHASE". documentType must be "LOI".

Extract these fields from the document text only. Use null when not clearly stated — do not guess.
- seller: the seller entity name
- buyer: the buyer entity name
- aircraft, msn, term, jurisdiction, governing_law, indicative_value

IMPORTANT: Return ALL field keys below. Use null for missing values.

Return flat JSON — string or null values only:
{
  "dealType": "PURCHASE",
  "documentType": "LOI",
  "fields": {
    "seller": null,
    "buyer": null,
    "aircraft": null,
    "msn": null,
    "term": null,
    "jurisdiction": null,
    "governing_law": null,
    "indicative_value": null
  }
}

DOCUMENT TEXT:
${text}`;
}

export function buildOlaTier1Prompt(
  text: string,
  dealType: "LEASE" | "PURCHASE"
): string {
  const partyFields =
    dealType === "LEASE"
      ? "lessor_entity, lessee_entity"
      : "seller_entity, buyer_entity";

  return `You are an expert in aircraft lease/purchase agreement header sections.

dealType must be "${dealType}".

From the text below extract header-level fields only. Use null when not clearly stated.
- ${partyFields}
- aircraft, msn
- governing_law, jurisdiction
- lease_term or term if stated

IMPORTANT: Return ALL field keys in "fields". Use null for missing values.

Return flat JSON:
{
  "dealType": "${dealType}",
  "fields": {
    "lessor_entity": null,
    "lessee_entity": null,
    "seller_entity": null,
    "buyer_entity": null,
    "aircraft": null,
    "msn": null,
    "governing_law": null,
    "jurisdiction": null,
    "lease_term": null
  }
}

DOCUMENT TEXT:
${text}`;
}

export function buildOlaSectionPrompt(
  sectionId: string,
  fieldKeys: string[],
  text: string,
  dealType: "LEASE" | "PURCHASE",
  options?: { tocContext?: string }
): string {
  const profile = getOlaProfile(dealType);
  const section = profile.sections.find((s) => s.id === sectionId);
  const fieldList = section
    ? section.fields.map((f) => `- ${f.key}: ${f.label}`).join("\n")
    : fieldKeys.map((k) => `- ${k}`).join("\n");

  const tocBlock = options?.tocContext
    ? `\nDOCUMENT CONTEXT (from table of contents — orientation only, do NOT use as field values):\n${options.tocContext}\n`
    : "";

  return `You are an expert in aircraft operating lease / purchase agreements.

Extract ONLY the following fields for section "${sectionId}" from SECTION TEXT below.
- Use null when not clearly stated in SECTION TEXT
- Do not guess or invent values
- You MUST return every field key listed (use null if absent)
- Extract values only from SECTION TEXT, not from TOC context
${tocBlock}
Fields:
${fieldList}

Return flat JSON with ALL field keys (string or null values only):
{
  ${fieldKeys.map((k) => `"${k}": null`).join(",\n  ")}
}

SECTION TEXT:
${text}`;
}
