import type { LoiTemplateSectionDef } from "@/lib/generation/loi-draft-types";

export const LOI_MASTER_TEMPLATE_SECTIONS: LoiTemplateSectionDef[] = [
  {
    id: "overview",
    title: "1. Transaction Overview",
    fields: [
      { key: "lessor", label: "Lessor", defaultValue: "To be confirmed" },
      { key: "lessee", label: "Lessee", briefKey: "counterparty" },
      { key: "aircraft", label: "Aircraft type", briefKey: "aircraft" },
      {
        key: "number_of_aircraft",
        label: "Number of aircraft",
        briefKey: "aircraft_count",
      },
      {
        key: "transaction_type",
        label: "Transaction type",
        briefKey: "transaction_type",
      },
    ],
  },
  {
    id: "commercial",
    title: "2. Commercial Terms",
    fields: [
      { key: "lease_term", label: "Lease term", briefKey: "lease_term" },
      { key: "monthly_rent", label: "Monthly rent", briefKey: "monthly_rent" },
      {
        key: "security_deposit",
        label: "Security deposit",
        briefKey: "security_deposit",
      },
      {
        key: "maintenance_reserve",
        label: "Maintenance reserve",
        briefKey: "maintenance_reserve",
      },
      { key: "insurance", label: "Insurance", briefKey: "insurance" },
      {
        key: "expected_delivery",
        label: "Expected delivery",
        briefKey: "expected_delivery",
      },
    ],
  },
  {
    id: "legal",
    title: "3. Governing Law & Jurisdiction",
    fields: [
      { key: "governing_law", label: "Governing law" },
      { key: "jurisdiction", label: "Jurisdiction" },
    ],
  },
  {
    id: "cp",
    title: "4. Conditions Precedent",
    fields: [
      {
        key: "conditions_precedent",
        label: "Conditions precedent",
        defaultValue:
          "Effectiveness of the definitive lease documentation is conditional upon execution of the operating lease agreement, delivery of legal opinions, regulatory approvals, and technical acceptance of the aircraft in agreed condition.",
      },
    ],
  },
  {
    id: "misc",
    title: "5. Validity",
    fields: [
      {
        key: "validity_period",
        label: "Validity of terms",
        defaultValue:
          "This letter of intent remains open for acceptance for 30 days from the date hereof.",
      },
    ],
  },
];

export const LOI_MASTER_DOCUMENT_TITLE = "Letter of Intent";
