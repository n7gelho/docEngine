"use client";

import { OLA_SECTION_FILTER_LABELS, LOI_FILTER_FIELDS } from "@/lib/profiles/schema-registry";

export type FilterState = {
  dealType: string;
  documentType: string;
  status: string;
  q: string;
  loiLessor: string;
  loiLessee: string;
  loiSeller: string;
  loiBuyer: string;
  loiAircraft: string;
  loiMsn: string;
  loiTerm: string;
  loiJurisdiction: string;
  loiGoverningLaw: string;
  loiIndicativeValue: string;
  olaSections: Record<string, string>;
};

const OLA_SECTION_IDS = Object.keys(OLA_SECTION_FILTER_LABELS);

export const emptyFilters: FilterState = {
  dealType: "",
  documentType: "",
  status: "",
  q: "",
  loiLessor: "",
  loiLessee: "",
  loiSeller: "",
  loiBuyer: "",
  loiAircraft: "",
  loiMsn: "",
  loiTerm: "",
  loiJurisdiction: "",
  loiGoverningLaw: "",
  loiIndicativeValue: "",
  olaSections: Object.fromEntries(OLA_SECTION_IDS.map((id) => [id, ""])),
};

type MetadataFiltersProps = {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
};

export function MetadataFilters({
  filters,
  onChange,
  onApply,
  onReset,
}: MetadataFiltersProps) {
  function updateLoiField(key: keyof FilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  function updateOlaSection(sectionId: string, value: string) {
    onChange({
      ...filters,
      olaSections: { ...filters.olaSections, [sectionId]: value },
    });
  }

  function updateCommon(key: "dealType" | "documentType" | "status" | "q", value: string) {
    onChange({ ...filters, [key]: value });
  }

  const hasLoiFilters = LOI_FILTER_FIELDS.some((f) => {
    const key = loiFieldToStateKey(f.key);
    return Boolean(filters[key as keyof FilterState]);
  });

  const hasOlaFilters = OLA_SECTION_IDS.some(
    (id) => filters.olaSections[id]?.trim()
  );

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Common filters</h2>
          <button type="button" onClick={onReset} className="btn-secondary">
            Reset
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Deal type</label>
            <select
              className="input"
              value={filters.dealType}
              onChange={(e) => updateCommon("dealType", e.target.value)}
            >
              <option value="">Any</option>
              <option value="LEASE">Lease</option>
              <option value="PURCHASE">Purchase</option>
            </select>
          </div>
          <div>
            <label className="label">Document type</label>
            <select
              className="input"
              value={filters.documentType}
              onChange={(e) => updateCommon("documentType", e.target.value)}
            >
              <option value="">Any</option>
              <option value="LOI">LOI</option>
              <option value="OLA">OLA</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={filters.status}
              onChange={(e) => updateCommon("status", e.target.value)}
            >
              <option value="">Any</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label className="label">Filename keyword</label>
            <input
              className="input"
              value={filters.q}
              onChange={(e) => updateCommon("q", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-1 text-lg font-semibold">LOI filters</h2>
        <p className="mb-4 text-sm text-muted">
          Applies to LOI documents
          {hasLoiFilters && !filters.documentType ? " (document type LOI implied)" : ""}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LOI_FILTER_FIELDS.map((field) => {
            const stateKey = loiFieldToStateKey(field.key);
            return (
              <div key={field.key}>
                <label className="label">{field.label}</label>
                <input
                  className="input"
                  value={String(filters[stateKey as keyof FilterState] ?? "")}
                  onChange={(e) =>
                    updateLoiField(stateKey as keyof FilterState, e.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-1 text-lg font-semibold">OLA section filters</h2>
        <p className="mb-4 text-sm text-muted">
          Search within each OLA section (free text)
          {hasOlaFilters && !filters.documentType ? " (document type OLA implied)" : ""}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OLA_SECTION_IDS.map((sectionId) => (
            <div key={sectionId}>
              <label className="label">{OLA_SECTION_FILTER_LABELS[sectionId]}</label>
              <input
                className="input"
                value={filters.olaSections[sectionId] ?? ""}
                onChange={(e) => updateOlaSection(sectionId, e.target.value)}
                placeholder="Search section content…"
              />
            </div>
          ))}
        </div>
      </div>

      <button type="button" onClick={onApply} className="btn-primary">
        Apply filters
      </button>
    </div>
  );
}

function loiFieldToStateKey(fieldKey: string): string {
  const map: Record<string, string> = {
    lessor: "loiLessor",
    lessee: "loiLessee",
    seller: "loiSeller",
    buyer: "loiBuyer",
    aircraft: "loiAircraft",
    msn: "loiMsn",
    term: "loiTerm",
    jurisdiction: "loiJurisdiction",
    governing_law: "loiGoverningLaw",
    indicative_value: "loiIndicativeValue",
  };
  return map[fieldKey] ?? fieldKey;
}

export function filtersToQuery(filters: FilterState): string {
  const params = new URLSearchParams();

  if (filters.dealType) params.set("dealType", filters.dealType);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);

  let documentType = filters.documentType;
  const hasLoi = LOI_FILTER_FIELDS.some((f) => {
    const key = loiFieldToStateKey(f.key) as keyof FilterState;
    return Boolean(filters[key]);
  });
  const hasOla = OLA_SECTION_IDS.some((id) => filters.olaSections[id]?.trim());
  if (!documentType && hasLoi && !hasOla) documentType = "LOI";
  if (!documentType && hasOla && !hasLoi) documentType = "OLA";
  if (documentType) params.set("documentType", documentType);

  if (filters.loiLessor) params.set("lessor", filters.loiLessor);
  if (filters.loiLessee) params.set("lessee", filters.loiLessee);
  if (filters.loiSeller) params.set("seller", filters.loiSeller);
  if (filters.loiBuyer) params.set("buyer", filters.loiBuyer);
  if (filters.loiAircraft) params.set("aircraftType", filters.loiAircraft);
  if (filters.loiMsn) params.set("msn", filters.loiMsn);
  if (filters.loiTerm) params.set("term", filters.loiTerm);
  if (filters.loiJurisdiction) params.set("jurisdiction", filters.loiJurisdiction);
  if (filters.loiGoverningLaw) params.set("governingLaw", filters.loiGoverningLaw);
  if (filters.loiIndicativeValue) {
    params.set("indicativeValue", filters.loiIndicativeValue);
  }

  for (const sectionId of OLA_SECTION_IDS) {
    const value = filters.olaSections[sectionId]?.trim();
    if (value) params.set(`olaSection_${sectionId}`, value);
  }

  return params.toString();
}
