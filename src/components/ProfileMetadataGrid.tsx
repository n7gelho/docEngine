"use client";

import type { DocumentMetadataJson } from "@/lib/db/schema";
import {
  getProfile,
  parseOlaFlatFieldKey,
  type OlaProfileDefinition,
} from "@/lib/profiles/schema-registry";
import type { MetadataField } from "@/lib/types";

type ProfileMetadataGridProps = {
  dealType: string | null;
  documentType: string | null;
  metadata?: Record<string, MetadataField> | DocumentMetadataJson | null;
  columnValues?: {
    governingLaw?: string | null;
    jurisdiction?: string | null;
    term?: string | null;
    indicativeValue?: string | null;
    lessor?: string | null;
    lessee?: string | null;
    seller?: string | null;
    buyer?: string | null;
    aircraftType?: string | null;
    msn?: string | null;
  };
};

const LOI_COLUMN_MAP: Record<string, keyof NonNullable<ProfileMetadataGridProps["columnValues"]>> = {
  lessor: "lessor",
  lessee: "lessee",
  seller: "seller",
  buyer: "buyer",
  aircraft: "aircraftType",
  msn: "msn",
  term: "term",
  jurisdiction: "jurisdiction",
  governing_law: "governingLaw",
  indicative_value: "indicativeValue",
};

/** OLA section entity keys promoted to top-level document columns. */
const OLA_ENTITY_TOP_LEVEL: Record<string, keyof NonNullable<ProfileMetadataGridProps["columnValues"]>> = {
  lessor_entity: "lessor",
  lessee_entity: "lessee",
  seller_entity: "seller",
  buyer_entity: "buyer",
};

function resolveMetadataField(
  metadata: Record<string, MetadataField> | null | undefined,
  key: string,
  dealType: string | null
): MetadataField | undefined {
  const direct = metadata?.[key];
  if (direct?.value !== null && direct?.value !== undefined && String(direct.value).trim() !== "") {
    return direct;
  }

  // Legacy: counterparty stored lessee/buyer under old schema
  if (key === "lessee" && dealType === "LEASE") {
    const legacy = metadata?.counterparty;
    if (legacy?.value != null && String(legacy.value).trim() !== "") return legacy;
  }
  if (key === "buyer" && dealType === "PURCHASE") {
    const legacy = metadata?.counterparty;
    if (legacy?.value != null && String(legacy.value).trim() !== "") return legacy;
  }

  return direct;
}

function resolveOlaSectionField(
  metadata: Record<string, MetadataField> | null | undefined,
  sectionId: string,
  fieldKey: string,
  columnValues?: ProfileMetadataGridProps["columnValues"]
): MetadataField | undefined {
  const flatKey = `${sectionId}.${fieldKey}`;
  const flat =
    metadata?.[flatKey] ??
    Object.entries(metadata ?? {}).find(([k]) => {
      const p = parseOlaFlatFieldKey(k);
      return p?.sectionId === sectionId && p.fieldKey === fieldKey;
    })?.[1];

  if (flat?.value !== null && flat?.value !== undefined && String(flat.value).trim() !== "") {
    return flat;
  }

  const topLevelKey = OLA_ENTITY_TOP_LEVEL[fieldKey];
  if (topLevelKey) {
    const fromMeta = metadata?.[topLevelKey];
    if (fromMeta?.value != null && String(fromMeta.value).trim() !== "") {
      return fromMeta;
    }
    const fromColumn = columnValues?.[topLevelKey];
    if (fromColumn != null && String(fromColumn).trim() !== "") {
      return { value: fromColumn, confidence: 0.8 };
    }
  }

  return flat;
}

function renderFieldValue(
  fieldKey: string,
  metadata: Record<string, MetadataField> | null | undefined,
  columnValues: ProfileMetadataGridProps["columnValues"],
  dealType: string | null,
  indicativeDefault?: boolean
) {
  const colKey = LOI_COLUMN_MAP[fieldKey];
  const fromColumn =
    colKey && columnValues?.[colKey] != null && columnValues[colKey] !== ""
      ? String(columnValues[colKey])
      : null;
  const field = resolveMetadataField(metadata, fieldKey, dealType);
  const display =
    fromColumn ??
    (field?.value !== null && field?.value !== undefined
      ? String(field.value)
      : "—");
  const indicative = Boolean(field?.indicative ?? indicativeDefault);

  return (
    <>
      {display}
      {indicative && display !== "—" && (
        <span className="ml-2 badge bg-amber-100 text-amber-800">indicative</span>
      )}
    </>
  );
}

export function ProfileMetadataGrid({
  dealType,
  documentType,
  metadata,
  columnValues,
}: ProfileMetadataGridProps) {
  const profile = getProfile(dealType, documentType);

  if (!profile) {
    return (
      <p className="text-sm text-muted">
        No profile metadata available for this document.
      </p>
    );
  }

  if (profile.kind === "LOI") {
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {profile.fields.map((fieldDef) => (
          <div key={fieldDef.key}>
            <dt className="label">{fieldDef.label}</dt>
            <dd>
              {renderFieldValue(
                fieldDef.key,
                metadata ?? undefined,
                columnValues,
                dealType,
                fieldDef.indicative
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const olaProfile = profile as OlaProfileDefinition;

  return (
    <div className="space-y-6">
      {olaProfile.sections.map((section) => (
        <div key={section.id}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            {section.label}
          </h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {section.fields.map((fieldDef) => {
              const field = resolveOlaSectionField(
                metadata ?? undefined,
                section.id,
                fieldDef.key,
                columnValues
              );
              const display =
                field?.value !== null && field?.value !== undefined
                  ? String(field.value)
                  : "—";

              return (
                <div key={fieldDef.key}>
                  <dt className="label">{fieldDef.label}</dt>
                  <dd>{display}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

function fieldHasValue(field: MetadataField | undefined): boolean {
  return (
    field?.value !== null &&
    field?.value !== undefined &&
    String(field.value).trim() !== ""
  );
}

export function flattenMetadataForTable(
  metadata: Record<string, MetadataField> | null | undefined,
  dealType: string | null,
  documentType: string | null,
  columnValues?: ProfileMetadataGridProps["columnValues"]
): Array<{ key: string; label: string; field: MetadataField }> {
  const profile = getProfile(dealType, documentType);
  if (!profile || !metadata) return [];

  const rows: Array<{ key: string; label: string; field: MetadataField }> = [];
  const seen = new Set<string>();

  function pushRow(key: string, label: string, field: MetadataField | undefined) {
    if (!field || !fieldHasValue(field) || seen.has(key)) return;
    seen.add(key);
    rows.push({ key, label, field });
  }

  if (profile.kind === "LOI") {
    for (const f of profile.fields) {
      if (f.key.startsWith("_")) continue;
      const field = resolveMetadataField(metadata, f.key, dealType);
      pushRow(f.key, f.label, field);
    }
    return rows;
  }

  for (const section of profile.sections) {
    for (const f of section.fields) {
      const flatKey = `${section.id}.${f.key}`;
      const field = resolveOlaSectionField(
        metadata,
        section.id,
        f.key,
        columnValues
      );
      pushRow(flatKey, `${section.label} — ${f.label}`, field);
    }
  }

  return rows;
}
