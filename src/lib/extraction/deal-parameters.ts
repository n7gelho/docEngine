import type {
  DealType,
  DocumentMetadataJson,
  DocumentType,
  FieldValue,
} from "@/lib/db/schema";

/** Canonical proforma / precedent-retrieval parameter keys (always 10). */
export const DEAL_PARAMETER_KEYS = [
  "counterparty",
  "aircraft",
  "aircraft_count",
  "transaction_type",
  "lease_term",
  "monthly_rent",
  "security_deposit",
  "maintenance_reserve",
  "insurance",
  "expected_delivery",
] as const;

export type DealParameterKey = (typeof DEAL_PARAMETER_KEYS)[number];

export type DealParametersCoverage = {
  filled: number;
  total: number;
};

export type DealParametersInput = {
  dealType: DealType;
  documentType: DocumentType;
  metadata: DocumentMetadataJson;
  lessor?: string | null;
  lessee?: string | null;
  seller?: string | null;
  buyer?: string | null;
  aircraftType?: string | null;
  term?: string | null;
  leaseType?: string | null;
  monthlyRent?: number | null;
  currency?: string | null;
  aircraftCount?: number | null;
  securityDeposit?: string | null;
  expectedDelivery?: string | null;
};

function fieldString(
  metadata: DocumentMetadataJson,
  key: string
): string | null {
  const v = metadata[key]?.value;
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  return text || null;
}

function fieldNumber(metadata: DocumentMetadataJson, key: string): number | null {
  const v = metadata[key]?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const parsed = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseMonthlyRentAmount(
  value: string | number | null | undefined,
  currency?: string | null
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = parseFloat(match[0].replace(/,/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatRentParameter(
  amount: number | null,
  currency?: string | null,
  raw?: string | null
): string | null {
  if (raw?.trim()) return raw.trim();
  if (amount === null) return null;
  return currency ? `${currency} ${amount}` : String(amount);
}

/** Proforma counterparty: lessee on lease deals, buyer on purchase deals. */
function resolveCounterparty(input: DealParametersInput): string | null {
  if (input.dealType === "LEASE") {
    return (
      input.lessee ??
      fieldString(input.metadata, "lessee") ??
      fieldString(input.metadata, "lessee_entity") ??
      fieldString(input.metadata, "counterparty")
    );
  }
  return (
    input.buyer ??
    fieldString(input.metadata, "buyer") ??
    fieldString(input.metadata, "buyer_entity") ??
    fieldString(input.metadata, "counterparty")
  );
}

function resolveAircraft(input: DealParametersInput): string | null {
  return (
    input.aircraftType ??
    fieldString(input.metadata, "aircraft") ??
    fieldString(input.metadata, "aircraft_type") ??
    fieldString(input.metadata, "parties_and_recitals.aircraft") ??
    fieldString(input.metadata, "definitions_and_interpretation.aircraft_description")
  );
}

function resolveAircraftCount(input: DealParametersInput): number | null {
  if (input.aircraftCount != null) return input.aircraftCount;
  return (
    fieldNumber(input.metadata, "aircraft_count") ??
    fieldNumber(input.metadata, "definitions_and_interpretation.aircraft_count")
  );
}

function resolveTransactionType(input: DealParametersInput): string | null {
  const direct =
    input.leaseType ??
    fieldString(input.metadata, "transaction_type") ??
    fieldString(input.metadata, "lease_type") ??
    fieldString(input.metadata, "definitions_and_interpretation.transaction_type");
  return direct;
}

function resolveLeaseTerm(input: DealParametersInput): string | null {
  return (
    input.term ??
    fieldString(input.metadata, "term") ??
    fieldString(input.metadata, "lease_term") ??
    fieldString(input.metadata, "definitions_and_interpretation.lease_term")
  );
}

function resolveMonthlyRent(input: DealParametersInput): string | null {
  const raw =
    fieldString(input.metadata, "monthly_rent") ??
    fieldString(input.metadata, "definitions_and_interpretation.monthly_rent");
  const amount =
    input.monthlyRent ?? parseMonthlyRentAmount(raw, input.currency);
  return formatRentParameter(amount, input.currency, raw);
}

function resolveSecurityDeposit(input: DealParametersInput): string | null {
  return (
    input.securityDeposit ??
    fieldString(input.metadata, "security_deposit") ??
    fieldString(input.metadata, "definitions_and_interpretation.security_deposit")
  );
}

function summarizeMaintenanceReserve(metadata: DocumentMetadataJson): string | null {
  const direct = fieldString(metadata, "maintenance_reserve");
  if (direct) return direct;

  const parts = [
    fieldString(metadata, "maintenance_reserves.reserve_type"),
    fieldString(metadata, "maintenance_reserves.rate_per_fh"),
    fieldString(metadata, "maintenance_reserves.rate_per_fc"),
    fieldString(metadata, "maintenance_reserves.payment_frequency"),
    fieldString(metadata, "maintenance_reserves.adjustment_mechanism"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("; ") : null;
}

function summarizeInsurance(metadata: DocumentMetadataJson): string | null {
  const direct = fieldString(metadata, "insurance");
  if (direct) return direct;

  const parts = [
    fieldString(metadata, "insurance.insurance_type"),
    fieldString(metadata, "insurance.coverage_amount"),
    fieldString(metadata, "insurance.deductibles"),
    fieldString(metadata, "insurance.insured_parties"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("; ") : null;
}

function resolveExpectedDelivery(input: DealParametersInput): string | null {
  return (
    input.expectedDelivery ??
    fieldString(input.metadata, "expected_delivery") ??
    fieldString(input.metadata, "definitions_and_interpretation.expected_delivery")
  );
}

function toFieldValue(value: string | number | null): FieldValue {
  return {
    value,
    confidence: value === null ? 0 : 0.85,
  };
}

export function countFilledDealParameters(
  parameters: Record<DealParameterKey, FieldValue>
): DealParametersCoverage {
  const filled = DEAL_PARAMETER_KEYS.filter((key) => {
    const v = parameters[key]?.value;
    return v !== null && v !== undefined && String(v).trim() !== "";
  }).length;
  return { filled, total: DEAL_PARAMETER_KEYS.length };
}

export function buildDealParameters(
  input: DealParametersInput
): {
  parameters: Record<DealParameterKey, FieldValue>;
  coverage: DealParametersCoverage;
} {
  const parameters: Record<DealParameterKey, FieldValue> = {
    counterparty: toFieldValue(resolveCounterparty(input)),
    aircraft: toFieldValue(resolveAircraft(input)),
    aircraft_count: toFieldValue(resolveAircraftCount(input)),
    transaction_type: toFieldValue(resolveTransactionType(input)),
    lease_term: toFieldValue(resolveLeaseTerm(input)),
    monthly_rent: toFieldValue(resolveMonthlyRent(input)),
    security_deposit: toFieldValue(resolveSecurityDeposit(input)),
    maintenance_reserve: toFieldValue(
      summarizeMaintenanceReserve(input.metadata)
    ),
    insurance: toFieldValue(summarizeInsurance(input.metadata)),
    expected_delivery: toFieldValue(resolveExpectedDelivery(input)),
  };

  return {
    parameters,
    coverage: countFilledDealParameters(parameters),
  };
}

export function dealParametersToMetadataField(
  parameters: Record<DealParameterKey, FieldValue>
): FieldValue {
  return {
    value: JSON.stringify(parameters),
    confidence: 1,
    rawLabel: "_deal_parameters",
  };
}

export function dealParametersCoverageToMetadataField(
  coverage: DealParametersCoverage
): FieldValue {
  return {
    value: JSON.stringify(coverage),
    confidence: 1,
    rawLabel: "_deal_parameters_coverage",
  };
}

export function parseDealParameters(
  metadata: DocumentMetadataJson | null | undefined
): Record<DealParameterKey, FieldValue> | null {
  const raw = metadata?._deal_parameters?.value;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, FieldValue>;
    const result = {} as Record<DealParameterKey, FieldValue>;
    for (const key of DEAL_PARAMETER_KEYS) {
      result[key] = parsed[key] ?? toFieldValue(null);
    }
    return result;
  } catch {
    return null;
  }
}

export function parseDealParametersCoverage(
  metadata: DocumentMetadataJson | null | undefined
): DealParametersCoverage | null {
  const raw = metadata?._deal_parameters_coverage?.value;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as DealParametersCoverage;
  } catch {
    return null;
  }
}

export function formatDealParametersLine(
  coverage: DealParametersCoverage | null
): string {
  if (!coverage) return "deal parameters: —";
  return `deal parameters: ${coverage.filled}/${coverage.total}`;
}
