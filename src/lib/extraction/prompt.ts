import { getOlaProfile } from "@/lib/profiles/schema-registry";

export const EXTRACTION_SYSTEM_PROMPT =
  "Extract structured aircraft deal metadata. Respond with valid JSON only. Use null for fields with no clear evidence. Do not invent values.";

export function buildLoiExtractionPrompt(
  text: string,
  dealType: "LEASE" | "PURCHASE"
): string {
  if (dealType === "LEASE") {
    return `You are an expert in aircraft deal LOI (Letter of Intent) documents.

dealType must be "LEASE". documentType must be "LOI".

Extract these fields (null if not found):
- lessor: the lessor entity name
- counterparty: the lessee entity name (same as lessee if both appear)
- lessee: the lessee entity name when explicitly labeled
- aircraft, msn, term, jurisdiction, governing_law, indicative_value

Return flat JSON — string or null values only:
{
  "dealType": "LEASE",
  "documentType": "LOI",
  "fields": {
    "lessor": null,
    "counterparty": null,
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

Extract these fields (null if not found):
- seller: the seller entity name
- counterparty: the buyer entity name (same as buyer if both appear)
- buyer: the buyer entity name when explicitly labeled
- aircraft, msn, term, jurisdiction, governing_law, indicative_value

Return flat JSON — string or null values only:
{
  "dealType": "PURCHASE",
  "documentType": "LOI",
  "fields": {
    "seller": null,
    "counterparty": null,
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
      ? "lessor_entity, lessee_entity, counterparty (lessee)"
      : "seller_entity, buyer_entity, counterparty (buyer)";

  return `You are an expert in aircraft lease/purchase agreement header sections.

dealType must be "${dealType}".

From the text below extract header-level fields only (null if not found):
- ${partyFields}
- aircraft, msn
- governing_law, jurisdiction
- lease_term or term if stated

Return flat JSON:
{
  "dealType": "${dealType}",
  "fields": {
    "counterparty": null,
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
  dealType: "LEASE" | "PURCHASE"
): string {
  const profile = getOlaProfile(dealType);
  const section = profile.sections.find((s) => s.id === sectionId);
  const fieldList = section
    ? section.fields.map((f) => `- ${f.key}: ${f.label}`).join("\n")
    : fieldKeys.map((k) => `- ${k}`).join("\n");

  return `You are an expert in aircraft operating lease / purchase agreements.

Extract ONLY the following fields for section "${sectionId}" from the text below.
Use null when not clearly stated. Do not guess.

Fields:
${fieldList}

Return flat JSON with field keys as top-level properties (string or null values only):
{
  ${fieldKeys.map((k) => `"${k}": null`).join(",\n  ")}
}

SECTION TEXT:
${text}`;
}
