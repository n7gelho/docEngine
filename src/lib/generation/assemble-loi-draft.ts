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
import { peelEmbeddedPreambleFromFields } from "@/lib/generation/loi-preamble-split";
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
  SectionPortPreviewResult,
  SectionPortProposal,
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

function isSectionAdopted(
  sectionKey: string,
  adoptedSectionKeys?: string[]
): boolean {
  if (adoptedSectionKeys === undefined) return true;
  return adoptedSectionKeys.includes(sectionKey);
}

function proposalWhyText(
  title: string,
  briefKeys: DealParameterKey[],
  brief: ProformaBrief,
  fieldScore: number
): string {
  const filled = briefKeys.filter((key) => {
    const value = brief[key];
    return value !== null && value !== undefined && String(value).trim();
  });
  if (filled.length > 0) {
    const labels = filled
      .slice(0, 3)
      .map((key) => key.replace(/_/g, " "))
      .join(", ");
    return `Best match for “${title}” — aligns with your proforma on ${labels}.`;
  }
  if (fieldScore >= 0.6) {
    return `Strong precedent boilerplate for “${title}” from your selected LOI.`;
  }
  return `Suggested wording for “${title}” from the closest precedent section.`;
}

function truncatePreview(text: string, max = 220): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trim()}…`;
}

async function loadPrecedentSources(
  input: AssembleLoiDraftInput
): Promise<PrecedentSource[]> {
  const ids = input.precedentDocumentIds ?? [];
  if (ids.length === 0) return [];

  const matchScoreMap = new Map(
    Object.entries(input.precedentMatchScores ?? {})
  );
  const rows = await db
    .select()
    .from(documents)
    .where(inArray(documents.id, ids));

  const order = new Map(ids.map((id, index) => [id, index]));
  return rows
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    .map((row) =>
      documentToPrecedentSource(
        row,
        matchScoreMap.get(row.id) ?? 0,
        input.brief
      )
    );
}

function resolveTemplateDonor(
  precedents: PrecedentSource[],
  templateOnly: boolean
): PrecedentSource | null {
  if (templateOnly || precedents.length === 0) return null;

  const templateDonorRow = pickTopByPrecedentScore(
    precedents,
    (p) => p.precedentScore
  );
  const donorWithSections = templateDonorRow
    ? precedents.find((p) => p.id === templateDonorRow.id)
    : precedents.find((p) => p.sections.length >= 3);

  if (donorWithSections && donorWithSections.sections.length >= 2) {
    return donorWithSections;
  }
  return null;
}

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
  precedent: PrecedentSource,
  templateDonor?: PrecedentSource | null
): ReconcilePrecedentExtras {
  return {
    governingLaw: precedent.governingLaw,
    lessor: precedent.lessor,
    lessee: precedent.lessee,
    seller: precedent.seller,
    buyer: precedent.buyer,
    currency: precedent.currency,
    templateLessor: templateDonor?.lessor ?? precedent.lessor,
    templateLessee: templateDonor?.lessee ?? precedent.lessee,
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
  usedDonorKeys?: Set<string>,
  templateDonor?: PrecedentSource | null,
  adoptedSectionKeys?: string[]
): LoiDraftField {
  if (
    templateOnly ||
    precedents.length === 0 ||
    !isSectionAdopted(templateSection.id, adoptedSectionKeys)
  ) {
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
    reconcileExtrasForPrecedent(picked.precedent, templateDonor)
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
  templateOnly: boolean,
  templateDonor?: PrecedentSource | null,
  adoptedSectionKeys?: string[]
): LoiDraftSection[] {
  return LOI_MASTER_TEMPLATE_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    fields: section.fields.map((fieldDef) => {
      if (
        templateOnly ||
        precedents.length === 0 ||
        !isSectionAdopted(fieldDef.key, adoptedSectionKeys)
      ) {
        const skeleton =
          adoptedSectionKeys !== undefined ||
          (precedents.length === 0 && !templateOnly);
        return {
          key: fieldDef.key,
          label: fieldDef.label,
          value: skeleton ? null : (fieldDef.defaultValue ?? null),
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
        reconcileExtrasForPrecedent(best.precedent, templateDonor)
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

export async function buildSectionPortProposals(
  input: AssembleLoiDraftInput
): Promise<SectionPortPreviewResult> {
  const templateOnly = input.templateOnly ?? false;
  const precedents = await loadPrecedentSources(input);
  const fieldDonors =
    !templateOnly && precedents.length > 0
      ? filterEligibleFieldDonors(precedents, (p) => p.precedentScore)
      : precedents;

  const donorWithSections = resolveTemplateDonor(precedents, templateOnly);
  const proposals: SectionPortProposal[] = [];

  if (donorWithSections) {
    const usedDonorKeys = new Set<string>();
    for (const templateSection of donorWithSections.sections) {
      const picked = pickBestSectionDonor(
        templateSection,
        fieldDonors,
        input.brief,
        donorWithSections.id,
        usedDonorKeys
      );
      if (picked) usedDonorKeys.add(picked.donorKey);

      let portedText: string | null = null;
      if (picked) {
        const precedentValues = precedentValuesForBriefKeys(
          picked.precedent,
          templateSection.briefKeys
        );
        const reconciled = reconcileBoilerplateWithProforma(
          picked.text,
          input.brief,
          precedentValues,
          reconcileExtrasForPrecedent(picked.precedent, donorWithSections)
        );
        portedText = reconciled.text;
      }

      proposals.push({
        sectionKey: templateSection.id,
        title: templateSection.title,
        sourceFilename: picked?.precedent.filename ?? null,
        sourceDocumentId: picked?.precedent.id ?? null,
        fieldScore: picked?.fieldScore ?? 0,
        previewText: picked ? truncatePreview(picked.text) : "",
        portedText,
        why: picked
          ? proposalWhyText(
              templateSection.title,
              templateSection.briefKeys,
              input.brief,
              picked.fieldScore
            )
          : `No strong precedent section found for “${templateSection.title}”.`,
        recommended: Boolean(picked && picked.fieldScore >= 0.45),
      });
    }
  } else {
    for (const section of LOI_MASTER_TEMPLATE_SECTIONS) {
      for (const fieldDef of section.fields) {
        let best: {
          value: string;
          precedent: PrecedentSource;
          fieldScore: number;
        } | null = null;

        for (const precedent of fieldDonors) {
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
            brief: input.brief,
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

        const briefKeys = fieldDef.briefKey ? [fieldDef.briefKey] : [];
        let portedText: string | null = null;
        if (best) {
          const precedentValues = precedentValuesForBriefKeys(
            best.precedent,
            briefKeys
          );
          const reconciled = reconcileBoilerplateWithProforma(
            best.value,
            input.brief,
            precedentValues,
            reconcileExtrasForPrecedent(best.precedent, null)
          );
          portedText = reconciled.text;
        }

        proposals.push({
          sectionKey: fieldDef.key,
          title: fieldDef.label,
          sourceFilename: best?.precedent.filename ?? null,
          sourceDocumentId: best?.precedent.id ?? null,
          fieldScore: best?.fieldScore ?? 0,
          previewText: best ? truncatePreview(best.value) : "",
          portedText,
          why: best
            ? proposalWhyText(
                fieldDef.label,
                briefKeys,
                input.brief,
                best.fieldScore
              )
            : `No precedent value found for “${fieldDef.label}”.`,
          recommended: Boolean(best && best.fieldScore >= 0.45),
        });
      }
    }
  }

  return {
    templateDocumentId: donorWithSections?.id ?? null,
    templateFilename: donorWithSections?.filename ?? null,
    documentTitle: buildProjectTitle(input.brief, input.projectTitle),
    proposals,
  };
}

export async function assembleLoiDraft(
  input: AssembleLoiDraftInput
): Promise<AssembleLoiDraftResult> {
  const templateOnly = input.templateOnly ?? false;
  const adoptedSectionKeys = input.adoptedSectionKeys;
  const assemblyLog: AssemblyLogStep[] = [];

  const precedents = await loadPrecedentSources(input);

  const fieldDonors =
    !templateOnly && precedents.length > 0
      ? filterEligibleFieldDonors(precedents, (p) => p.precedentScore)
      : precedents;

  const templateDonorRow =
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

  const donorWithSections = resolveTemplateDonor(precedents, templateOnly);

  if (donorWithSections) {
    templateDocumentId = donorWithSections.id;
    templateFilename = donorWithSections.filename;

    assemblyLog.push({
      step: "Derived empty template from precedent",
      detail: `${donorWithSections.filename} — ${donorWithSections.sections.length} sections (precedent score ${Math.round(donorWithSections.precedentScore * 100)}%)`,
    });

    if (!templateOnly) {
      const portDetail =
        adoptedSectionKeys !== undefined
          ? `${adoptedSectionKeys.length} section${adoptedSectionKeys.length === 1 ? "" : "s"} opted in for porting`
          : `${fieldDonors.length} of ${precedents.length} selected LOI${precedents.length === 1 ? "" : "s"} used for field porting (within precedent-score threshold)`;
      assemblyLog.push({
        step: "Pulled relevant precedents",
        detail: portDetail,
      });
    }

    sections = [
      {
        id: "document_body",
        title: LOI_MASTER_DOCUMENT_TITLE,
        fields: peelEmbeddedPreambleFromFields(
          (() => {
            const usedDonorKeys = new Set<string>();
            return donorWithSections.sections.map((templateSection) =>
              resolveSectionField(
                templateSection,
                input.brief,
                fieldDonors,
                templateOnly,
                donorWithSections.id,
                usedDonorKeys,
                donorWithSections,
                adoptedSectionKeys
              )
            );
          })()
        ),
      },
    ];

    const peeledPreamble = sections[0]?.fields.find(
      (field) => field.key === "preamble" && field.value?.trim()
    );
    if (peeledPreamble) {
      assemblyLog.push({
        step: "Separated preamble",
        detail:
          "Opening letter text moved to its own preamble section for export",
      });
    }
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

    sections = buildFromMasterTemplate(
      input.brief,
      fieldDonors,
      templateOnly,
      templateDonorRow,
      adoptedSectionKeys
    );
  }

  const content: LoiDraftContent = {
    documentTitle: buildProjectTitle(input.brief, input.projectTitle),
    letterheadTitle: "LETTER OF INTENT",
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
