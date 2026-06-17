import type { ParsedDocument } from "@/lib/parsing/parse-document";
import type { DealType, FieldValue } from "@/lib/db/schema";
import {
  computeOlaCoverage,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import { describeExtractionSelection } from "@/lib/extraction/extraction-text";
import {
  ExtractionTraceCollector,
  type ExtractionTrace,
} from "@/lib/extraction/extraction-trace";
import { parseJsonContent } from "@/lib/extraction/llm-json";
import { callLlmInContext } from "@/lib/extraction/pipeline/llm-call";
import {
  trackModel,
  type ExtractionPipelineContext,
} from "@/lib/extraction/pipeline/context";
import { isOlaSectionComplete } from "@/lib/extraction/pipeline/section-skip";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import {
  normalizeFieldMap,
  parseFlatSectionFields,
} from "@/lib/extraction/normalize-extraction";
import {
  buildOlaCorePagesText,
  expandSectionText,
  getOlaSectionTexts,
  getTocMappedSections,
  type OlaSectionText,
} from "@/lib/extraction/ola-section-windows";
import {
  buildOlaSectionPrompt,
  buildOlaTier1Prompt,
} from "@/lib/extraction/prompt";
import { buildTocOrientationBlock } from "@/lib/extraction/toc-parser";
import type {
  ExtractionHint,
  OlaExtractionResult,
} from "@/lib/extraction/types";
import { validateFieldsAgainstSource } from "@/lib/extraction/validate-extraction";
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

const TIER1_SKIP_SECTIONS = new Set([
  "parties_and_recitals",
  "governing_law_and_jurisdiction",
]);

function countFilledFields(fields: Record<string, ParsedFieldValue>): number {
  return Object.values(fields).filter(
    (f) => f.value !== null && String(f.value).trim() !== ""
  ).length;
}

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
      ? ["lessor_entity", "lessee_entity", "aircraft", "msn"]
      : ["seller_entity", "buyer_entity", "aircraft", "msn"];

  for (const key of partyKeys) {
    if (tier1Fields[key]) parties[key] = tier1Fields[key];
  }

  if (tier1Fields.governing_law) gov.governing_law = tier1Fields.governing_law;
  if (tier1Fields.jurisdiction) gov.jurisdiction = tier1Fields.jurisdiction;
  if (tier1Fields.lease_term) definitions.lease_term = tier1Fields.lease_term;
  if (!definitions.lease_term && tier1Fields.term) {
    definitions.lease_term = tier1Fields.term;
  }

  const commercialKeys = [
    "aircraft_count",
    "transaction_type",
    "monthly_rent",
    "security_deposit",
    "expected_delivery",
  ] as const;
  for (const key of commercialKeys) {
    if (tier1Fields[key]) definitions[key] = tier1Fields[key];
  }

  return {
    parties_and_recitals: parties,
    governing_law_and_jurisdiction: gov,
    definitions_and_interpretation: definitions,
  };
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

function shouldSkipTier1(sectionTexts: OlaSectionText[]): boolean {
  return Array.from(TIER1_SKIP_SECTIONS).every((sectionId) => {
    const st = sectionTexts.find((s) => s.sectionId === sectionId);
    return st?.located && (st.text?.length ?? 0) >= MIN_SECTION_TEXT_CHARS;
  });
}

async function extractTier1(
  coreText: string,
  dealType: DealType,
  ctx: ExtractionPipelineContext
): Promise<{ fields: Record<string, ParsedFieldValue>; model: string }> {
  const { content, model } = await callLlmInContext(
    ctx,
    buildOlaTier1Prompt(coreText, dealType)
  );
  trackModel(ctx.model, model);
  const raw = parseJsonContent(content) as Record<string, unknown>;
  const fields =
    raw.fields && typeof raw.fields === "object"
      ? normalizeOlaPartyFields(
          normalizeFieldMap(raw.fields as Record<string, unknown>)
        )
      : normalizeOlaPartyFields(parseFlatSectionFields(raw));
  return {
    fields: validateFieldsAgainstSource(fields, coreText),
    model,
  };
}

function buildTocContext(
  section: OlaSectionText,
  tocMapped: ReturnType<typeof getTocMappedSections>
): string | undefined {
  const orientation = buildTocOrientationBlock(tocMapped, section.sectionId);
  if (orientation) return orientation;
  if (section.tocLabel) return `- TOC entry: ${section.tocLabel}`;
  return undefined;
}

async function extractSectionFields(
  sectionId: string,
  text: string,
  dealType: DealType,
  ctx: ExtractionPipelineContext,
  tocContext?: string
): Promise<{ fields: Record<string, ParsedFieldValue>; model: string }> {
  const profile = getOlaProfile(dealType);
  const section = profile.sections.find((s) => s.id === sectionId);
  if (!section) return { fields: {}, model: "" };

  const fieldKeys = section.fields.map((f) => f.key);
  const { content, model } = await callLlmInContext(
    ctx,
    buildOlaSectionPrompt(sectionId, fieldKeys, text, dealType, { tocContext })
  );
  trackModel(ctx.model, model);
  const raw = parseJsonContent(content) as Record<string, unknown>;
  const fields = parseFlatSectionFields(raw, fieldKeys);
  return {
    fields: validateFieldsAgainstSource(fields, text),
    model,
  };
}

async function extractSectionWithRetries(
  sectionId: string,
  section: OlaSectionText,
  dealType: DealType,
  ctx: ExtractionPipelineContext,
  fullText: string,
  tocContext: string | undefined,
  warnings: string[],
  collector: ExtractionTraceCollector
): Promise<Record<string, ParsedFieldValue>> {
  const profile = getOlaProfile(dealType);
  const sectionDef = profile.sections.find((s) => s.id === sectionId);
  const fieldsTotal = sectionDef?.fields.length ?? 0;

  const runPass = async (
    text: string,
    kind: "section" | "section_retry",
    label: string
  ) => {
    const { fields, model } = await extractSectionFields(
      sectionId,
      text,
      dealType,
      ctx,
      tocContext
    );
    const filled = countFilledFields(fields);
    collector.recordLlmExtraction({
      kind,
      label,
      text: kind === "section" ? section.text : text,
      model,
      sectionId,
      located: true,
      locationSource: section.locationSource,
      tocLabel: section.tocLabel,
      fieldsFilled: filled,
      fieldsTotal,
    });
    return { fields, filled };
  };

  try {
    const { fields, filled } = await runPass(
      section.text,
      "section",
      `Section: ${sectionId}`
    );
    if (filled === 0) {
      warnings.push(`Section ${sectionId}: LLM returned no filled fields`);
    }
    return fields;
  } catch (firstError) {
    const message =
      firstError instanceof Error ? firstError.message : "extraction failed";

    if (section.text.length >= 400) {
      const expanded = expandSectionText(fullText, section, 2);
      if (expanded.length > section.text.length) {
        try {
          warnings.push(
            `Section ${sectionId}: retrying after error (${message})`
          );
          const { fields, filled } = await runPass(
            expanded,
            "section_retry",
            `Section retry: ${sectionId}`
          );
          if (filled === 0) {
            warnings.push(`Section ${sectionId}: retry returned no filled fields`);
          }
          return fields;
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error
              ? retryError.message
              : "retry failed";
          warnings.push(`Section ${sectionId}: ${retryMessage}`);
          throw retryError;
        }
      }
    }

    warnings.push(`Section ${sectionId}: ${message}`);
    throw firstError;
  }
}

async function runSectionBatch(
  batch: Array<{ sectionId: string; text: string; section: OlaSectionText }>,
  dealType: DealType,
  ctx: ExtractionPipelineContext,
  fullText: string,
  tocMapped: ReturnType<typeof getTocMappedSections>,
  warnings: string[],
  collector: ExtractionTraceCollector
): Promise<Record<string, Record<string, ParsedFieldValue>>> {
  const results = await Promise.all(
    batch.map(async ({ sectionId, section }) => {
      const tocContext = buildTocContext(section, tocMapped);
      try {
        const fields = await extractSectionWithRetries(
          sectionId,
          section,
          dealType,
          ctx,
          fullText,
          tocContext,
          warnings,
          collector
        );
        return { sectionId, fields };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "extraction failed";
        const profile = getOlaProfile(dealType);
        const fieldsTotal =
          profile.sections.find((s) => s.id === sectionId)?.fields.length ?? 0;
        collector.recordLlmExtraction({
          kind: "section",
          label: `Section: ${sectionId}`,
          text: section.text,
          model: ctx.model.primary ?? undefined,
          sectionId,
          located: true,
          locationSource: section.locationSource,
          fieldsFilled: 0,
          fieldsTotal,
          error: message,
        });
        return { sectionId, fields: {} as Record<string, ParsedFieldValue> };
      }
    })
  );

  return Object.fromEntries(results.map((r) => [r.sectionId, r.fields]));
}

export async function extractOlaMetadata(
  parsed: ParsedDocument,
  hint: ExtractionHint,
  ctx: ExtractionPipelineContext,
  trace?: ExtractionTraceCollector
): Promise<{
  result: OlaExtractionResult;
  model: string;
  coverage: ExtractionCoverage;
  trace: ExtractionTrace;
}> {
  const collector = trace ?? new ExtractionTraceCollector();
  const dealType = hint.dealType ?? "LEASE";
  const warnings: string[] = [];
  const sections: Record<string, Record<string, ParsedFieldValue>> = {};

  const sectionTexts = getOlaSectionTexts(parsed, collector);
  const tocMapped = getTocMappedSections(parsed.fullText);
  const sectionsLocated = sectionTexts.filter((s) => s.located).length;
  const coreText = buildOlaCorePagesText(parsed);
  const selection = describeExtractionSelection(parsed);
  const skipTier1 = shouldSkipTier1(sectionTexts);

  if (skipTier1) {
    collector.record({
      kind: "tier1",
      label: "OLA tier-1 header (skipped)",
      inputChars: 0,
      inputPreview: "",
      outputSummary:
        "Skipped — parties and governing law sections already located via TOC/regex",
    });
  } else {
    try {
      const tier1 = await extractTier1(coreText, dealType, ctx);
      collector.recordLlmExtraction({
        kind: "tier1",
        label: "OLA tier-1 header",
        text: coreText,
        model: tier1.model,
        pageNumbers: selection.selectedPageNumbers,
        fieldsFilled: countFilledFields(tier1.fields),
        fieldsTotal: 7,
      });

      for (const [sectionId, fields] of Object.entries(
        tier1ToSections(tier1.fields, dealType)
      )) {
        sections[sectionId] = { ...(sections[sectionId] ?? {}), ...fields };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "extraction failed";
      warnings.push(`Tier-1 header: ${message}`);
      collector.recordLlmExtraction({
        kind: "tier1",
        label: "OLA tier-1 header",
        text: coreText,
        model: ctx.model.primary ?? undefined,
        pageNumbers: selection.selectedPageNumbers,
        fieldsFilled: 0,
        fieldsTotal: 7,
        error: message,
      });
    }
  }

  const passSections = OLA_SECTION_PASS_ORDER.filter((sectionId) => {
    const st = sectionTexts.find((s) => s.sectionId === sectionId);
    if (!st?.located || (st.text?.length ?? 0) < MIN_SECTION_TEXT_CHARS) {
      return false;
    }
    if (isOlaSectionComplete(sectionId, dealType, sections)) {
      collector.recordSectionSkip({
        sectionId,
        reason: "All profile fields already filled — skipped LLM pass",
      });
      return false;
    }
    return true;
  });

  for (let i = 0; i < passSections.length; i += PARALLEL_SECTION_BATCH) {
    const batch = passSections.slice(i, i + PARALLEL_SECTION_BATCH).map(
      (sectionId) => ({
        sectionId,
        text: sectionTexts.find((s) => s.sectionId === sectionId)!.text,
        section: sectionTexts.find((s) => s.sectionId === sectionId)!,
      })
    );
    const batchResults = await runSectionBatch(
      batch,
      dealType,
      ctx,
      parsed.fullText,
      tocMapped,
      warnings,
      collector
    );
    for (const [sectionId, fields] of Object.entries(batchResults)) {
      sections[sectionId] = sections[sectionId] ?? {};
      mergeFieldMaps(sections[sectionId], fields, true);
    }
  }

  for (const st of sectionTexts) {
    if (st.located) continue;
    collector.recordSectionSkip({
      sectionId: st.sectionId,
      reason: "Section not located in document (TOC + regex)",
    });
    const sectionFields = sections[st.sectionId] ?? {};
    const hasFilledFields = Object.values(sectionFields).some(
      (f) => f.value !== null && String(f.value).trim() !== ""
    );
    if (!hasFilledFields) {
      warnings.push(`Section ${st.sectionId}: not located in document`);
    }
  }

  if (!ctx.model.primary) {
    throw new Error(
      "OLA extraction failed: no AI provider completed successfully"
    );
  }

  return {
    result: {
      dealType,
      documentType: "OLA",
      sections: sections as Record<string, Record<string, FieldValue>>,
    },
    model: ctx.model.primary,
    coverage: computeOlaCoverage(sections, sectionsLocated, warnings, dealType),
    trace: collector.toTrace(),
  };
}
