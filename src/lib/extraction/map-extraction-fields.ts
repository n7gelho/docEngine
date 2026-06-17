import type {
  DealType,
  DocumentMetadataJson,
  DocumentType,
  FieldValue,
} from "@/lib/db/schema";
import {
  buildDealParameters,
  dealParametersCoverageToMetadataField,
  dealParametersToMetadataField,
  parseMonthlyRentAmount,
} from "@/lib/extraction/deal-parameters";
import { softCopyLoiGoverningLawJurisdiction } from "@/lib/extraction/align-loi-governing-law";
import {
  coverageToMetadataField,
  type ExtractionCoverage,
} from "@/lib/extraction/extraction-coverage";
import {
  traceToMetadataField,
  type ExtractionTrace,
} from "@/lib/extraction/extraction-trace";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import type { ExtractionResult } from "@/lib/extraction/types";
import { getProfile, olaFlatFieldKey } from "@/lib/profiles/schema-registry";

function fieldString(fields: DocumentMetadataJson, key: string): string | null {
  const v = fields[key]?.value;
  if (v === null || v === undefined) return null;
  return String(v);
}

function fieldInt(fields: DocumentMetadataJson, key: string): number | null {
  const v = fields[key]?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return Math.trunc(v);
  const parsed = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function flattenOlaSections(
  sections: Record<string, Record<string, ParsedFieldValue>>
): DocumentMetadataJson {
  const flat: DocumentMetadataJson = {};
  const sectionText: Record<string, string> = {};

  for (const [sectionId, sectionFields] of Object.entries(sections)) {
    const textParts: string[] = [];
    for (const [fieldKey, fieldVal] of Object.entries(sectionFields)) {
      flat[olaFlatFieldKey(sectionId, fieldKey)] = fieldVal as FieldValue;
      if (fieldVal.value !== null && fieldVal.value !== undefined) {
        textParts.push(String(fieldVal.value));
      }
    }
    if (textParts.length > 0) {
      sectionText[sectionId] = textParts.join(" ");
    }
  }

  flat._section_text = {
    value: JSON.stringify(sectionText),
    confidence: 1,
    rawLabel: "_section_text",
  };

  return flat;
}

function promoteCommercialMetadata(metadata: DocumentMetadataJson): void {
  const commercialKeys = [
    "aircraft_count",
    "transaction_type",
    "monthly_rent",
    "security_deposit",
    "expected_delivery",
    "maintenance_reserve",
    "insurance",
  ] as const;

  for (const key of commercialKeys) {
    const fromDefinitions = metadata[`definitions_and_interpretation.${key}`];
    if (fromDefinitions && !metadata[key]) {
      metadata[key] = fromDefinitions as FieldValue;
    }
  }
}

export function mapExtractionToDocumentFields(
  extraction: ExtractionResult,
  coverage?: ExtractionCoverage,
  trace?: ExtractionTrace
): {
  documentType: DocumentType;
  dealType: DealType;
  profileId: string | null;
  counterparty: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  aircraftType: string | null;
  msn: string | null;
  registration: string | null;
  jurisdiction: string | null;
  term: string | null;
  indicativeValue: string | null;
  leaseType: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  monthlyRent: number | null;
  currency: string | null;
  governingLaw: string | null;
  aircraftCount: number | null;
  securityDeposit: string | null;
  expectedDelivery: string | null;
  metadata: DocumentMetadataJson;
} {
  const dealType = extraction.dealType;
  let documentType = extraction.documentType;
  let metadata: DocumentMetadataJson = {};

  if ("sections" in extraction && extraction.documentType === "OLA") {
    metadata = flattenOlaSections(extraction.sections);
    const parties = extraction.sections.parties_and_recitals ?? {};
    const gov = extraction.sections.governing_law_and_jurisdiction ?? {};
    const definitions = extraction.sections.definitions_and_interpretation ?? {};

    if (dealType === "LEASE") {
      if (parties.lessor_entity?.value) {
        metadata.lessor = parties.lessor_entity as FieldValue;
      }
      if (parties.lessee_entity?.value) {
        metadata.lessee = parties.lessee_entity as FieldValue;
      }
    } else {
      if (parties.seller_entity?.value) {
        metadata.seller = parties.seller_entity as FieldValue;
      }
      if (parties.buyer_entity?.value) {
        metadata.buyer = parties.buyer_entity as FieldValue;
      }
    }
    if (gov.governing_law) metadata.governing_law = gov.governing_law as FieldValue;
    if (gov.jurisdiction) metadata.jurisdiction = gov.jurisdiction as FieldValue;
    if (parties.aircraft) metadata.aircraft = parties.aircraft as FieldValue;
    if (parties.msn) metadata.msn = parties.msn as FieldValue;
    if (definitions.lease_term) {
      metadata.term = definitions.lease_term as FieldValue;
    }
  } else if ("fields" in extraction) {
    metadata = { ...(extraction.fields as DocumentMetadataJson) };
    documentType = extraction.documentType;
    if (documentType === "LOI") {
      softCopyLoiGoverningLawJurisdiction(
        metadata as Record<string, ParsedFieldValue>
      );
      delete metadata.indicative_value;
    }
  }

  promoteCommercialMetadata(metadata);

  if (coverage) {
    metadata._extraction_coverage = coverageToMetadataField(
      coverage
    ) as FieldValue;
  }

  if (trace) {
    metadata._extraction_trace = traceToMetadataField(trace) as FieldValue;
  }

  const getString = (key: string): string | null => fieldString(metadata, key);
  const profile = getProfile(dealType, documentType);

  if (dealType === "LEASE" && documentType === "LOI") {
    const lessee =
      getString("lessee") ??
      getString("lessee_entity") ??
      getString("counterparty");
    if (lessee && !metadata.lessee) {
      metadata.lessee = { value: lessee, confidence: 0.8 };
    }
  } else if (dealType === "PURCHASE" && documentType === "LOI") {
    const buyer =
      getString("buyer") ??
      getString("buyer_entity") ??
      getString("counterparty");
    if (buyer && !metadata.buyer) {
      metadata.buyer = { value: buyer, confidence: 0.8 };
    }
  }

  const lessor = getString("lessor") ?? getString("lessor_entity");
  const lessee = getString("lessee") ?? getString("lessee_entity");
  const seller = getString("seller") ?? getString("seller_entity");
  const buyer = getString("buyer") ?? getString("buyer_entity");
  const aircraftType = getString("aircraft") ?? getString("aircraft_type");
  const term = getString("term") ?? getString("lease_term");
  const currency = getString("currency");
  const monthlyRentRaw = getString("monthly_rent");
  const monthlyRent = parseMonthlyRentAmount(monthlyRentRaw, currency);
  const aircraftCount = fieldInt(metadata, "aircraft_count");
  const leaseType =
    getString("transaction_type") ?? getString("lease_type");
  const securityDeposit = getString("security_deposit");
  const expectedDelivery = getString("expected_delivery");

  const counterparty =
    dealType === "LEASE" ? lessee : dealType === "PURCHASE" ? buyer : null;

  const { parameters, coverage: dealParamCoverage } = buildDealParameters({
    dealType,
    documentType,
    metadata,
    lessor,
    lessee,
    seller,
    buyer,
    aircraftType,
    term,
    leaseType,
    monthlyRent,
    currency,
    aircraftCount,
    securityDeposit,
    expectedDelivery,
  });

  metadata._deal_parameters = dealParametersToMetadataField(parameters);
  metadata._deal_parameters_coverage = dealParametersCoverageToMetadataField(
    dealParamCoverage
  );

  return {
    documentType,
    dealType,
    profileId: profile?.id ?? null,
    counterparty,
    lessor,
    lessee,
    seller,
    buyer,
    aircraftType,
    msn: getString("msn"),
    registration: getString("registration"),
    jurisdiction: getString("jurisdiction"),
    term,
    indicativeValue:
      documentType === "LOI" ? null : getString("indicative_value"),
    leaseType,
    effectiveDate: getString("effective_date"),
    expiryDate: getString("expiry_date"),
    monthlyRent,
    currency,
    governingLaw: getString("governing_law"),
    aircraftCount,
    securityDeposit,
    expectedDelivery,
    metadata,
  };
}
