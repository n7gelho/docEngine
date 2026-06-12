import type { ParsedDocument } from "@/lib/parsing/parse-document";
import type { DealType, FieldValue } from "@/lib/db/schema";
import {
  computeOlaCoverage,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import {
  normalizeFieldMap,
  parseFlatSectionFields,
} from "@/lib/extraction/normalize-extraction";
import {
  buildOlaCorePagesText,
  getOlaSectionTexts,
} from "@/lib/extraction/ola-section-windows";
import {
  buildOlaSectionPrompt,
  buildOlaTier1Prompt,
} from "@/lib/extraction/prompt";
import { callLlmJson, parseJsonContent } from "@/lib/extraction/llm-json";
import type {
  ExtractionHint,
  OlaExtractionResult,
} from "@/lib/extraction/types";
import { getOlaProfile } from "@/lib/profiles/schema-registry";

const OLA_SECTION_PASS_ORDER = [
  "parties_and_recitals",
  "governing_law_and_jurisdiction",
  "maintenance_reserves",
  "insurance",
  "redelivery_conditions",
  "default_interest",
  "cape_town_convention",
  "notices",
  "definitions_and_interpretation",
] as const;

const PARALLEL_SECTION_BATCH = 3;
const MIN_SECTION_TEXT_CHARS = 80;

function mergeFieldMaps(
  target: Record<string, ParsedFieldValue>,
  source: Record<string, ParsedFieldValue>,
  preferSource = true
): void {
  for (const [key, fv] of Object.entries(source)) {
    const existing = target[key];
    const sourceFilled =
      fv.value !== null && fv.value !== undefined && String(fv.value).trim() !== "";
    const existingFilled =
      existing?.value !== null &&
      existing?.value !== undefined &&
      String(existing.value).trim() !== "";

    if (preferSource && sourceFilled) {
      target[key] = fv;
    } else if (!existingFilled && sourceFilled) {
      target[key] = fv;
    } else if (!existing) {
      target[key] = fv;
    }
  }
}

function tier1ToSections(
  tier1Fields: Record<string, ParsedFieldValue>,
  dealType: DealType
): Record<string, Record<string, ParsedFieldValue>> {
  const parties: Record<string, ParsedFieldValue> = {};
  const gov: Record<string, ParsedFieldValue> = {};
  const definitions: Record<string, ParsedFieldValue> = {};

  const partyKeys =
    dealType === "LEASE"
      ? ["counterparty", "lessor_entity", "lessee_entity", "aircraft", "msn"]
      : ["counterparty", "seller_entity", "buyer_entity", "aircraft", "msn"];

  for (const key of partyKeys) {
    if (tier1Fields[key]) parties[key] = tier1Fields[key];
  }

  if (tier1Fields.governing_law) gov.governing_law = tier1Fields.governing_law;
  if (tier1Fields.jurisdiction) gov.jurisdiction = tier1Fields.jurisdiction;
  if (tier1Fields.lease_term) definitions.lease_term = tier1Fields.lease_term;

  return {
    parties_and_recitals: parties,
    governing_law_and_jurisdiction: gov,
    definitions_and_interpretation: definitions,
  };
}

async function extractTier1(
  coreText: string,
  dealType: DealType
): Promise<{ fields: Record<string, ParsedFieldValue>; model: string }> {
  const { content, model } = await callLlmJson(
    buildOlaTier1Prompt(coreText, dealType)
  );
  const raw = parseJsonContent(content) as Record<string, unknown>;
  const fields =
    raw.fields && typeof raw.fields === "object"
      ? normalizeOlaPartyFields(
          normalizeFieldMap(raw.fields as Record<string, unknown>)
        )
      : normalizeOlaPartyFields(parseFlatSectionFields(raw));
  return { fields, model };
}

function normalizeOlaPartyFields(
  fields: Record<string, ParsedFieldValue>
): Record<string, ParsedFieldValue> {
  const out = { ...fields };
  if (out.lessor && !out.lessor_entity) out.lessor_entity = out.lessor;
  if (out.lessee && !out.lessee_entity) out.lessee_entity = out.lessee;
  if (out.seller && !out.seller_entity) out.seller_entity = out.seller;
  if (out.buyer && !out.buyer_entity) out.buyer_entity = out.buyer;
  return out;
}

async function extractSectionFields(
  sectionId: string,
  text: string,
  dealType: DealType
): Promise<Record<string, ParsedFieldValue>> {
  const profile = getOlaProfile(dealType);
  const section = profile.sections.find((s) => s.id === sectionId);
  if (!section) return {};

  const fieldKeys = section.fields.map((f) => f.key);
  const { content } = await callLlmJson(
    buildOlaSectionPrompt(sectionId, fieldKeys, text, dealType)
  );
  const raw = parseJsonContent(content) as Record<string, unknown>;
  return parseFlatSectionFields(raw, fieldKeys);
}

async function runSectionBatch(
  batch: Array<{ sectionId: string; text: string }>,
  dealType: DealType,
  warnings: string[]
): Promise<Record<string, Record<string, ParsedFieldValue>>> {
  const results = await Promise.all(
    batch.map(async ({ sectionId, text }) => {
      try {
        const fields = await extractSectionFields(sectionId, text, dealType);
        const filled = Object.values(fields).filter(
          (f) => f.value !== null && String(f.value).trim() !== ""
        ).length;
        if (filled === 0) {
          warnings.push(`Section ${sectionId}: LLM returned no filled fields`);
        }
        return { sectionId, fields };
      } catch (error) {
        warnings.push(
          `Section ${sectionId}: ${
            error instanceof Error ? error.message : "extraction failed"
          }`
        );
        return { sectionId, fields: {} as Record<string, ParsedFieldValue> };
      }
    })
  );

  return Object.fromEntries(results.map((r) => [r.sectionId, r.fields]));
}

export async function extractOlaMetadata(
  parsed: ParsedDocument,
  hint: ExtractionHint
): Promise<{
  result: OlaExtractionResult;
  model: string;
  coverage: ExtractionCoverage;
}> {
  const dealType = hint.dealType ?? "LEASE";
  const warnings: string[] = [];
  const sections: Record<string, Record<string, ParsedFieldValue>> = {};
  let model = "heuristic-v3";

  const sectionTexts = getOlaSectionTexts(parsed);
  const sectionsLocated = sectionTexts.filter((s) => s.located).length;

  try {
    const tier1 = await extractTier1(buildOlaCorePagesText(parsed), dealType);
    model = tier1.model;
    for (const [sectionId, fields] of Object.entries(
      tier1ToSections(tier1.fields, dealType)
    )) {
      sections[sectionId] = { ...(sections[sectionId] ?? {}), ...fields };
    }
  } catch (error) {
    warnings.push(
      `Tier-1 header: ${
        error instanceof Error ? error.message : "extraction failed"
      }`
    );
  }

  const passSections = OLA_SECTION_PASS_ORDER.filter((sectionId) => {
    const st = sectionTexts.find((s) => s.sectionId === sectionId);
    return st?.located && (st.text?.length ?? 0) >= MIN_SECTION_TEXT_CHARS;
  });

  for (let i = 0; i < passSections.length; i += PARALLEL_SECTION_BATCH) {
    const batch = passSections.slice(i, i + PARALLEL_SECTION_BATCH).map(
      (sectionId) => ({
        sectionId,
        text: sectionTexts.find((s) => s.sectionId === sectionId)!.text,
      })
    );
    const batchResults = await runSectionBatch(batch, dealType, warnings);
    for (const [sectionId, fields] of Object.entries(batchResults)) {
      sections[sectionId] = sections[sectionId] ?? {};
      const preferSection =
        sectionId !== "parties_and_recitals" &&
        sectionId !== "definitions_and_interpretation";
      mergeFieldMaps(sections[sectionId], fields, preferSection);
    }
  }

  for (const st of sectionTexts) {
    if (st.located) continue;
    const sectionFields = sections[st.sectionId] ?? {};
    const hasFilledFields = Object.values(sectionFields).some(
      (f) => f.value !== null && String(f.value).trim() !== ""
    );
    if (!hasFilledFields) {
      warnings.push(`Section ${st.sectionId}: not located in document`);
    }
  }

  return {
    result: {
      dealType,
      documentType: "OLA",
      sections: sections as Record<string, Record<string, FieldValue>>,
    },
    model,
    coverage: computeOlaCoverage(sections, sectionsLocated, warnings),
  };
}
