import type {

  DealType,

  DocumentMetadataJson,

  DocumentType,

  FieldValue,

} from "@/lib/db/schema";

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

  }



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



  delete metadata.counterparty;



  return {

    documentType,

    dealType,

    profileId: profile?.id ?? null,

    counterparty: null,

    lessor: getString("lessor") ?? getString("lessor_entity"),

    lessee: getString("lessee") ?? getString("lessee_entity"),

    seller: getString("seller") ?? getString("seller_entity"),

    buyer: getString("buyer") ?? getString("buyer_entity"),

    aircraftType: getString("aircraft") ?? getString("aircraft_type"),

    msn: getString("msn"),

    registration: getString("registration"),

    jurisdiction: getString("jurisdiction"),

    term: getString("term") ?? getString("lease_term"),

    indicativeValue: getString("indicative_value"),

    leaseType: getString("lease_type") ?? getString("lease_term"),

    effectiveDate: getString("effective_date"),

    expiryDate: getString("expiry_date"),

    monthlyRent: null,

    currency: getString("currency"),

    governingLaw: getString("governing_law"),

    aircraftCount: null,

    metadata,

  };

}


