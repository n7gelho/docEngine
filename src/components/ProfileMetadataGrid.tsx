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
    counterparty?: string | null;
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
  seller: "seller",
  counterparty: "counterparty",
  lessee: "lessee",
  buyer: "buyer",
  aircraft: "aircraftType",
  msn: "msn",
  term: "term",
  jurisdiction: "jurisdiction",
  governing_law: "governingLaw",
  indicative_value: "indicativeValue",
};

function renderFieldValue(
  fieldKey: string,
  metadata: Record<string, MetadataField> | null | undefined,
  columnValues: ProfileMetadataGridProps["columnValues"],
  indicativeDefault?: boolean
) {
  const colKey = LOI_COLUMN_MAP[fieldKey];
  const fromColumn =
    colKey && columnValues?.[colKey] != null && columnValues[colKey] !== ""
      ? String(columnValues[colKey])
      : null;
  const field = metadata?.[fieldKey];
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
              const flatKey = `${section.id}.${fieldDef.key}`;
              const field =
                metadata?.[flatKey] ??
                Object.entries(metadata ?? {}).find(([k]) => {
                  const p = parseOlaFlatFieldKey(k);
                  return (
                    p?.sectionId === section.id && p.fieldKey === fieldDef.key
                  );
                })?.[1];
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

export function flattenMetadataForTable(
  metadata: Record<string, MetadataField> | null | undefined,
  dealType: string | null,
  documentType: string | null
): Array<{ key: string; label: string; field: MetadataField }> {
  const profile = getProfile(dealType, documentType);
  if (!profile || !metadata) return [];

  const rows: Array<{ key: string; label: string; field: MetadataField }> = [];

  if (profile.kind === "LOI") {
    for (const f of profile.fields) {
      const field = metadata[f.key];
      if (field && !f.key.startsWith("_")) {
        rows.push({ key: f.key, label: f.label, field });
      }
    }
    return rows;
  }

  for (const section of profile.sections) {
    for (const f of section.fields) {
      const flatKey = `${section.id}.${f.key}`;
      const field = metadata[flatKey];
      if (field) {
        rows.push({
          key: flatKey,
          label: `${section.label} — ${f.label}`,
          field,
        });
      }
    }
  }

  return rows;
}
