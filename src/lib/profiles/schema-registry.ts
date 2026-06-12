export type DealType = "PURCHASE" | "LEASE";

export type FieldDefinition = {
  key: string;
  label: string;
  indicative?: boolean;
};

export type OlaSectionDefinition = {
  id: string;
  label: string;
  fields: FieldDefinition[];
};

export type LoiProfileDefinition = {
  kind: "LOI";
  id: string;
  dealType: DealType;
  documentType: "LOI";
  fields: FieldDefinition[];
};

export type OlaProfileDefinition = {
  kind: "OLA";
  id: string;
  dealType: DealType;
  documentType: "OLA";
  sections: OlaSectionDefinition[];
};

export type ProfileDefinition = LoiProfileDefinition | OlaProfileDefinition;

export const SCHEMA_VERSION = "3.0.0";

const LOI_CORE_FIELDS: FieldDefinition[] = [
  { key: "aircraft", label: "Aircraft" },
  { key: "msn", label: "MSN" },
  { key: "term", label: "Term", indicative: true },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "governing_law", label: "Governing Law" },
  { key: "indicative_value", label: "Indicative Value", indicative: true },
];

function loiFieldsForDealType(dealType: DealType): FieldDefinition[] {
  if (dealType === "LEASE") {
    return [
      { key: "lessor", label: "Lessor" },
      { key: "counterparty", label: "Lessee" },
      ...LOI_CORE_FIELDS,
    ];
  }
  return [
    { key: "seller", label: "Seller" },
    { key: "counterparty", label: "Buyer" },
    ...LOI_CORE_FIELDS,
  ];
}

/** All LOI fields shown in filters (lease + purchase party fields). */
export const LOI_FILTER_FIELDS: FieldDefinition[] = [
  { key: "lessor", label: "Lessor" },
  { key: "seller", label: "Seller" },
  { key: "counterparty", label: "Counterparty" },
  ...LOI_CORE_FIELDS,
];

function olaSectionsForDealType(dealType: DealType): OlaSectionDefinition[] {
  const primaryParty =
    dealType === "LEASE"
      ? [
          { key: "lessor_entity", label: "Lessor Entity" },
          { key: "lessee_entity", label: "Lessee Entity" },
        ]
      : [
          { key: "seller_entity", label: "Seller Entity" },
          { key: "buyer_entity", label: "Buyer Entity" },
        ];

  return [
    {
      id: "parties_and_recitals",
      label: "Parties and Recitals",
      fields: [
        { key: "counterparty", label: "Counterparty" },
        ...primaryParty,
        { key: "aircraft", label: "Aircraft" },
        { key: "msn", label: "MSN" },
      ],
    },
    {
      id: "definitions_and_interpretation",
      label: "Definitions and Interpretation",
      fields: [
        { key: "defined_terms", label: "Defined Terms" },
        { key: "aircraft_description", label: "Aircraft Description" },
        { key: "lease_term", label: "Lease Term" },
      ],
    },
    {
      id: "governing_law_and_jurisdiction",
      label: "Governing Law & Jurisdiction",
      fields: [
        { key: "governing_law", label: "Governing Law" },
        { key: "jurisdiction", label: "Jurisdiction" },
      ],
    },
    {
      id: "maintenance_reserves",
      label: "Maintenance Reserves",
      fields: [
        { key: "reserve_type", label: "Reserve Type" },
        { key: "rate_per_fh", label: "$/FH" },
        { key: "rate_per_fc", label: "$/FC" },
        { key: "payment_frequency", label: "Payment Frequency" },
        { key: "adjustment_mechanism", label: "Adjustment Mechanism" },
      ],
    },
    {
      id: "insurance",
      label: "Insurance",
      fields: [
        { key: "insurance_type", label: "Insurance Type" },
        { key: "coverage_amount", label: "Coverage Amount" },
        { key: "deductibles", label: "Deductibles" },
        { key: "insured_parties", label: "Insured Parties" },
      ],
    },
    {
      id: "redelivery_conditions",
      label: "Redelivery Conditions",
      fields: [
        { key: "return_condition_standard", label: "Return Condition Standard" },
        { key: "maintenance_status", label: "Maintenance Status" },
        { key: "documentation", label: "Documentation" },
        { key: "end_of_lease_compensation", label: "End-of-Lease Compensation" },
      ],
    },
    {
      id: "default_interest",
      label: "Default Interest",
      fields: [
        { key: "interest_rate", label: "Interest Rate" },
        { key: "calculation_method", label: "Calculation Method" },
        { key: "grace_period", label: "Grace Period" },
      ],
    },
    {
      id: "cape_town_convention",
      label: "Cape Town Convention",
      fields: [
        { key: "debtor_location", label: "Debtor Location" },
        { key: "registry_state", label: "Registry State" },
        { key: "international_interest", label: "International Interest" },
        { key: "idera", label: "IDERA" },
        { key: "filing_party", label: "Filing Party" },
      ],
    },
    {
      id: "notices",
      label: "Notices",
      fields: [
        { key: "addresses", label: "Addresses" },
        { key: "email_contacts", label: "Email Contacts" },
        { key: "delivery_method", label: "Delivery Method" },
        { key: "deemed_receipt_rule", label: "Deemed Receipt Rule" },
      ],
    },
  ];
}

export const LOI_PROFILES: LoiProfileDefinition[] = (
  ["LEASE", "PURCHASE"] as DealType[]
).map((dealType) => ({
  kind: "LOI" as const,
  id: `${dealType}_LOI@v3`,
  dealType,
  documentType: "LOI" as const,
  fields: loiFieldsForDealType(dealType),
}));

export const OLA_PROFILES: OlaProfileDefinition[] = (
  ["LEASE", "PURCHASE"] as DealType[]
).map((dealType) => ({
  kind: "OLA" as const,
  id: `${dealType}_OLA@v3`,
  dealType,
  documentType: "OLA" as const,
  sections: olaSectionsForDealType(dealType),
}));

export const PROFILES: ProfileDefinition[] = [...LOI_PROFILES, ...OLA_PROFILES];

export function getProfile(
  dealType: DealType | string | null,
  documentType: string | null
): ProfileDefinition | null {
  if (!dealType || !documentType) return null;
  return (
    PROFILES.find(
      (p) => p.dealType === dealType && p.documentType === documentType
    ) ?? null
  );
}

export function getLoiProfile(dealType: DealType | string): LoiProfileDefinition {
  return LOI_PROFILES.find((p) => p.dealType === dealType) ?? LOI_PROFILES[0];
}

export function getOlaProfile(dealType: DealType | string): OlaProfileDefinition {
  return OLA_PROFILES.find((p) => p.dealType === dealType) ?? OLA_PROFILES[0];
}

export function getFieldLabel(
  profile: ProfileDefinition | null,
  fieldKey: string
): string {
  if (!profile) return fieldKey.replace(/_/g, " ");
  if (profile.kind === "LOI") {
    return profile.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey;
  }
  for (const section of profile.sections) {
    const field = section.fields.find((f) => f.key === fieldKey);
    if (field) return field.label;
  }
  return fieldKey.replace(/_/g, " ");
}

export function getOlaSectionIds(): string[] {
  return olaSectionsForDealType("LEASE").map((s) => s.id);
}

export function olaFlatFieldKey(sectionId: string, fieldKey: string): string {
  return `${sectionId}.${fieldKey}`;
}

export function parseOlaFlatFieldKey(key: string): {
  sectionId: string;
  fieldKey: string;
} | null {
  const dot = key.indexOf(".");
  if (dot <= 0) return null;
  return {
    sectionId: key.slice(0, dot),
    fieldKey: key.slice(dot + 1),
  };
}

export const OLA_SECTION_FILTER_LABELS: Record<string, string> =
  Object.fromEntries(
    olaSectionsForDealType("LEASE").map((s) => [s.id, s.label])
  );

