import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, type Document } from "@/lib/db/schema";
import {
  buildDealParameters,
  type DealParameterKey,
} from "@/lib/extraction/deal-parameters";
import { computeDraftCompleteness } from "@/lib/generation/draft-completeness";
import {
  donorSectionKey,
  extractLoiSections,
  resolveDonorSection,
  type ExtractedLoiSection,
} from "@/lib/generation/loi-section-extract";
import {
  LOI_MASTER_DOCUMENT_TITLE,
  LOI_MASTER_TEMPLATE_SECTIONS,
} from "@/lib/generation/loi-master-template";
import { reconcileBoilerplateWithProforma } from "@/lib/generation/proforma-reconcile";
import type { ReconcilePrecedentExtras } from "@/lib/generation/proforma-reconcile";
import type {
  AssembleLoiDraftInput,
  AssembleLoiDraftResult,
  AssemblyLogStep,
  DraftFieldSource,
  LoiDraftContent,
  LoiDraftField,
  LoiDraftSection,
} from "@/lib/generation/loi-draft-types";
import { scoreFieldDonor, scoreSectionDonor } from "@/lib/retrieval/field-score";
import {
  getFilledBriefKeys,
  normalizeBriefValue,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import {
  computePrecedentScore,
  filterEligibleFieldDonors,
  pickTopByPrecedentScore,
} from "@/lib/retrieval/precedent-combined-score";
import { computeSuitabilityScore } from "@/lib/retrieval/template-fitness";

type PrecedentSource = {
  id: string;
  filename: string;
  fullText: string | null;
  metadata: Document["metadata"];
  documentType: string | null;
  dealType: string | null;
  governingLaw: string | null;
  jurisdiction: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  currency: string | null;
  effectiveDate: string | null;
  createdAt: Date;
  parameters: Record<DealParameterKey, { value: string | number | null }>;
  sections: ExtractedLoiSection[];
  matchScore: number;
  suitabilityScore: number;
  precedentScore: number;
};

function documentToPrecedentSource(
  row: Document,
  matchScore: number,
  brief: ProformaBrief
): PrecedentSource {
  const { parameters } = buildDealParameters({
    dealType: (row.dealType as "LEASE" | "PURCHASE") ?? "LEASE",
    documentType: "LOI",
    metadata: row.metadata ?? {},
    lessor: row.lessor,
    lessee: row.lessee,
    seller: row.seller,
    buyer: row.buyer,
    aircraftType: row.aircraftType,
    term: row.term,
    leaseType: row.leaseType,
    monthlyRent: row.monthlyRent,
    currency: row.currency,
    securityDeposit: row.securityDeposit,
    expectedDelivery: row.expectedDelivery,
    aircraftCount: row.aircraftCount,
  });

  const flat: Record<DealParameterKey, { value: string | number | null }> =
    {} as Record<DealParameterKey, { value: string | number | null }>;
  for (const key of Object.keys(parameters) as DealParameterKey[]) {
    const raw = parameters[key]?.value ?? null;
    const normalized =
      raw === null || raw === undefined || typeof raw === "boolean"
        ? null
        : raw;
    flat[key] = { value: normalized };
  }

  const suitabilityScore = computeSuitabilityScore(
    {
      governingLaw: row.governingLaw,
      createdAt: row.createdAt,
    },
    brief
  ).score;

  const resolvedMatchScore = matchScore;
  const precedentScore = computePrecedentScore(
    resolvedMatchScore,
    suitabilityScore
  );

  return {
    id: row.id,
    filename: row.filename,
    fullText: row.fullText,
    metadata: row.metadata ?? {},
    documentType: row.documentType,
    dealType: row.dealType,
    governingLaw: row.governingLaw,
    jurisdiction: row.jurisdiction,
    lessor: row.lessor,
    lessee: row.lessee,
    seller: row.seller,
    buyer: row.buyer,
    currency: row.currency,
    effectiveDate: row.effectiveDate,
    createdAt: row.createdAt,
    parameters: flat,
    sections: extractLoiSections(row.fullText),
    matchScore: resolvedMatchScore,
    suitabilityScore,
    precedentScore,
  };
}

function parameterValueAsString(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function precedentValuesForBriefKeys(
  precedent: PrecedentSource,
  briefKeys: DealParameterKey[]
): Partial<Record<DealParameterKey, string | null>> {
  const out: Partial<Record<DealParameterKey, string | null>> = {};
  for (const key of briefKeys) {
    const raw = precedent.parameters[key]?.value ?? null;
    out[key] = parameterValueAsString(raw);
  }
  if (precedent.lessee && briefKeys.includes("counterparty")) {
    out.counterparty = out.counterparty ?? precedent.lessee;
  }
  return out;
}

function reconcileExtrasForPrecedent(
  precedent: PrecedentSource
): ReconcilePrecedentExtras {
  return {
    governingLaw: precedent.governingLaw,
    lessor: precedent.lessor,
    lessee: precedent.lessee,
    seller: precedent.seller,
    buyer: precedent.buyer,
    currency: precedent.currency,
  };
}

function getSectionTextFromPrecedent(
  precedent: PrecedentSource,
  templateSection: ExtractedLoiSection,
  options?: {
    preferIndex?: boolean;
    usedDonorKeys?: Set<string>;
  }
): string | null {
  const resolved = resolveDonorSection(
    templateSection,
    precedent.sections,
    { preferIndex: options?.preferIndex }
  );
  if (!resolved?.fullText.trim()) return null;

  const key = donorSectionKey(precedent.id, resolved);
  if (options?.usedDonorKeys?.has(key)) {
    const byIndex = precedent.sections[templateSection.index];
    if (
      byIndex &&
      byIndex.fullText.trim() &&
      !options.usedDonorKeys.has(donorSectionKey(precedent.id, byIndex))
    ) {
      return byIndex.fullText.trim();
    }
    return null;
  }

  return resolved.fullText.trim();
}

function pickBestSectionDonor(
  templateSection: ExtractedLoiSection,
  precedents: PrecedentSource[],
  brief: ProformaBrief,
  templateDonorId?: string | null,
  usedDonorKeys?: Set<string>
): {
  text: string;
  precedent: PrecedentSource;
  fieldScore: number;
  donorKey: string;
} | null {
  let best: {
    text: string;
    precedent: PrecedentSource;
    fieldScore: number;
    meetsThreshold: boolean;
    donorKey: string;
  } | null = null;

  for (const precedent of precedents) {
    const preferIndex = precedent.id === templateDonorId;
    const sectionText = getSectionTextFromPrecedent(precedent, templateSection, {
      preferIndex,
      usedDonorKeys,
    });
    if (!sectionText) continue;

    const resolved = resolveDonorSection(templateSection, precedent.sections, {
      preferIndex,
    });
    const donorKey = resolved
      ? donorSectionKey(precedent.id, resolved)
      : `${precedent.id}:${templateSection.index}`;

    const { score, meetsThreshold } = scoreSectionDonor(
      sectionText,
      templateSection.briefKeys,
      brief,
      precedent.metadata,
      precedent.matchScore
    );

    if (!best || score > best.fieldScore) {
      best = {
        text: sectionText,
        precedent,
        fieldScore: score,
        meetsThreshold,
        donorKey,
      };
    }
  }

  if (best?.meetsThreshold) {
    return {
      text: best.text,
      precedent: best.precedent,
      fieldScore: best.fieldScore,
      donorKey: best.donorKey,
    };
  }

  if (templateDonorId) {
    const templateDonor = precedents.find((p) => p.id === templateDonorId);
    if (templateDonor) {
      const fallbackText = getSectionTextFromPrecedent(
        templateDonor,
        templateSection,
        { preferIndex: true, usedDonorKeys }
      );
      const resolved = resolveDonorSection(
        templateSection,
        templateDonor.sections,
        { preferIndex: true }
      );
      if (fallbackText && resolved) {
        return {
          text: fallbackText,
          precedent: templateDonor,
          fieldScore: best?.fieldScore ?? 0.5,
          donorKey: donorSectionKey(templateDonor.id, resolved),
        };
      }
    }
  }

  if (best && best.fieldScore >= 0.35) {
    return {
      text: best.text,
      precedent: best.precedent,
      fieldScore: best.fieldScore,
      donorKey: best.donorKey,
    };
  }

  return null;
}

function resolveSectionField(
  templateSection: ExtractedLoiSection,
  brief: ProformaBrief,
  precedents: PrecedentSource[],
  templateOnly: boolean,
  templateDonorId?: string | null,
  usedDonorKeys?: Set<string>
): LoiDraftField {
  if (templateOnly || precedents.length === 0) {
    return {
      key: templateSection.id,
      label: templateSection.title,
      value: null,
      source: "template",
      precedentDocumentId: null,
      precedentFilename: null,
      fieldScore: null,
      briefKeys: templateSection.briefKeys,
      editable: true,
    };
  }

  const picked = pickBestSectionDonor(
    templateSection,
    precedents,
    brief,
    templateDonorId,
    usedDonorKeys
  );
  if (!picked) {
    return {
      key: templateSection.id,
      label: templateSection.title,
      value: null,
      source: "template",
      precedentDocumentId: null,
      precedentFilename: null,
      fieldScore: null,
      briefKeys: templateSection.briefKeys,
      editable: true,
    };
  }

  const precedentValues = precedentValuesForBriefKeys(
    picked.precedent,
    templateSection.briefKeys
  );

  const reconciled = reconcileBoilerplateWithProforma(
    picked.text,
    brief,
    precedentValues,
    reconcileExtrasForPrecedent(picked.precedent)
  );

  usedDonorKeys?.add(picked.donorKey);

  const source: DraftFieldSource = reconciled.reconciled
    ? "precedent+proforma"
    : "precedent";

  return {
    key: templateSection.id,
    label: templateSection.title,
    value: reconciled.text,
    source,
    precedentDocumentId: picked.precedent.id,
    precedentFilename: picked.precedent.filename,
    fieldScore: picked.fieldScore,
    briefKeys: templateSection.briefKeys,
    editable: true,
  };
}

function buildFromMasterTemplate(
  brief: ProformaBrief,
  precedents: PrecedentSource[],
  templateOnly: boolean
): LoiDraftSection[] {
  return LOI_MASTER_TEMPLATE_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    fields: section.fields.map((fieldDef) => {
      if (templateOnly || precedents.length === 0) {
        return {
          key: fieldDef.key,
          label: fieldDef.label,
          value: fieldDef.defaultValue ?? null,
          source: "template" as DraftFieldSource,
          precedentDocumentId: null,
          precedentFilename: null,
          fieldScore: null,
          briefKeys: fieldDef.briefKey ? [fieldDef.briefKey] : [],
          editable: true,
        };
      }

      let best: {
        value: string;
        precedent: PrecedentSource;
        fieldScore: number;
      } | null = null;

      for (const precedent of precedents) {
        let docValue: string | number | null = null;
        if (fieldDef.briefKey) {
          docValue = precedent.parameters[fieldDef.briefKey]?.value ?? null;
        } else if (fieldDef.key === "lessor") {
          docValue = precedent.lessor;
        } else if (fieldDef.key === "governing_law") {
          docValue = precedent.governingLaw;
        } else if (fieldDef.key === "jurisdiction") {
          docValue = precedent.jurisdiction;
        }

        const boilerplate =
          parameterValueAsString(docValue) ?? fieldDef.defaultValue ?? null;
        if (!boilerplate) continue;

        const { score, meetsThreshold } = scoreFieldDonor({
          briefKey: fieldDef.briefKey,
          brief,
          docValue,
          sectionText: boilerplate,
          metadata: precedent.metadata,
          docMatchScore: precedent.matchScore,
        });

        if (!meetsThreshold) continue;

        if (!best || score > best.fieldScore) {
          best = { value: boilerplate, precedent, fieldScore: score };
        }
      }

      if (!best) {
        return {
          key: fieldDef.key,
          label: fieldDef.label,
          value: fieldDef.defaultValue ?? null,
          source: "template" as DraftFieldSource,
          precedentDocumentId: null,
          precedentFilename: null,
          fieldScore: null,
          briefKeys: fieldDef.briefKey ? [fieldDef.briefKey] : [],
          editable: true,
        };
      }

      const briefKeys = fieldDef.briefKey ? [fieldDef.briefKey] : [];
      const precedentValues = precedentValuesForBriefKeys(
        best.precedent,
        briefKeys
      );
      const reconciled = reconcileBoilerplateWithProforma(
        best.value,
        brief,
        precedentValues,
        reconcileExtrasForPrecedent(best.precedent)
      );

      const source: DraftFieldSource = reconciled.reconciled
        ? "precedent+proforma"
        : "precedent";

      return {
        key: fieldDef.key,
        label: fieldDef.label,
        value: reconciled.text,
        source,
        precedentDocumentId: best.precedent.id,
        precedentFilename: best.precedent.filename,
        fieldScore: best.fieldScore,
        briefKeys,
        editable: true,
      };
    }),
  }));
}

function buildProjectTitle(brief: ProformaBrief, override?: string): string {
  if (override?.trim()) return override.trim();
  const cp = normalizeBriefValue(brief.counterparty);
  const ac = normalizeBriefValue(brief.aircraft);
  if (cp && ac) return `${cp} · ${ac}`;
  if (cp) return `${cp} LOI`;
  return "New LOI Draft";
}

export function renderLoiDraftText(content: LoiDraftContent): string {
  const blocks: string[] = [];

  if (content.documentTitle) {
    blocks.push(content.documentTitle);
    blocks.push("");
  }

  for (const section of content.sections) {
    for (const field of section.fields) {
      const value = field.value?.trim();
      if (value) {
        blocks.push(value);
        blocks.push("");
      }
    }
  }

  return blocks.join("\n").trim();
}

export async function assembleLoiDraft(
  input: AssembleLoiDraftInput
): Promise<AssembleLoiDraftResult> {
  const templateOnly = input.templateOnly ?? false;
  const ids = input.precedentDocumentIds ?? [];
  const assemblyLog: AssemblyLogStep[] = [];
  const matchScoreMap = new Map(
    Object.entries(input.precedentMatchScores ?? {})
  );

  let precedents: PrecedentSource[] = [];
  if (ids.length > 0) {
    const rows = await db
      .select()
      .from(documents)
      .where(inArray(documents.id, ids));

    const order = new Map(ids.map((id, index) => [id, index]));
    precedents = rows
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
      .map((row) =>
        documentToPrecedentSource(
          row,
          matchScoreMap.get(row.id) ?? 0,
          input.brief
        )
      );
  }

  const fieldDonors =
    !templateOnly && precedents.length > 0
      ? filterEligibleFieldDonors(precedents, (p) => p.precedentScore)
      : precedents;

  const templateDonor =
    !templateOnly && precedents.length > 0
      ? pickTopByPrecedentScore(precedents, (p) => p.precedentScore)
      : null;

  const proformaFilled = getFilledBriefKeys(input.brief).length;
  assemblyLog.push({
    step: "Mapped proforma parameters",
    detail: `${proformaFilled} confirmed term${proformaFilled === 1 ? "" : "s"} from your brief (applied via reconciliation after boilerplate port)`,
  });

  let sections: LoiDraftSection[] = [];
  let templateDocumentId: string | null = null;
  let templateFilename: string | null = null;

  const templateDonorRow = templateDonor;

  const donorWithSections = templateDonorRow
    ? precedents.find((p) => p.id === templateDonorRow.id)
    : precedents.find((p) => p.sections.length >= 3);

  if (donorWithSections && donorWithSections.sections.length >= 2) {
    templateDocumentId = donorWithSections.id;
    templateFilename = donorWithSections.filename;

    assemblyLog.push({
      step: "Derived empty template from precedent",
      detail: `${donorWithSections.filename} — ${donorWithSections.sections.length} sections (precedent score ${Math.round(donorWithSections.precedentScore * 100)}%)`,
    });

    if (!templateOnly) {
      assemblyLog.push({
        step: "Pulled relevant precedents",
        detail: `${fieldDonors.length} of ${precedents.length} selected LOI${precedents.length === 1 ? "" : "s"} used for field porting (within precedent-score threshold)`,
      });
    }

    sections = [
      {
        id: "document_body",
        title: LOI_MASTER_DOCUMENT_TITLE,
        fields: (() => {
          const usedDonorKeys = new Set<string>();
          return donorWithSections.sections.map((templateSection) =>
            resolveSectionField(
              templateSection,
              input.brief,
              fieldDonors,
              templateOnly,
              donorWithSections.id,
              usedDonorKeys
            )
          );
        })(),
      },
    ];
  } else {
    assemblyLog.push({
      step: "Matched master template",
      detail: `${LOI_MASTER_DOCUMENT_TITLE} — fallback short structure (no full-text sections in precedents)`,
    });

    if (!templateOnly && fieldDonors.length > 0) {
      assemblyLog.push({
        step: "Pulled relevant precedents",
        detail: `${fieldDonors.length} of ${precedents.length} selected LOI${precedents.length === 1 ? "" : "s"} used for field porting (within precedent-score threshold)`,
      });
    } else {
      assemblyLog.push({
        step: "Pulled relevant precedents",
        detail: "Skipped — drafting from master template only",
      });
    }

    sections = buildFromMasterTemplate(input.brief, fieldDonors, templateOnly);
  }

  const content: LoiDraftContent = {
    documentTitle: buildProjectTitle(input.brief, input.projectTitle),
    templateDocumentId,
    templateFilename,
    sections,
  };

  const { filledCount, totalCount, completenessPct } =
    computeDraftCompleteness(content);

  assemblyLog.push({
    step: "Draft assembled",
    detail: `${filledCount} of ${totalCount} sections/fields filled (${completenessPct}% complete)`,
  });

  return {
    content,
    assemblyLog,
    completenessPct,
    filledCount,
    totalCount,
  };
}
