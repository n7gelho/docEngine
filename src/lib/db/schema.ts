import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  doublePrecision,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { getEmbeddingDimensions } from "@/lib/ai/config";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${getEmbeddingDimensions()})`;
  },
  toDriver(value: number[]) {
    return JSON.stringify(value);
  },
  fromDriver(value: string) {
    if (typeof value === "string") {
      return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((v) => parseFloat(v.trim()));
    }
    return value as unknown as number[];
  },
});

export const documentStatusEnum = [
  "pending",
  "processing",
  "ready",
  "failed",
] as const;

export type DocumentStatus = (typeof documentStatusEnum)[number];

export type DocumentType = "LOI" | "OLA" | "OTHER";

export type DealType = "PURCHASE" | "LEASE";

export type FieldValue = {
  value: string | number | boolean | null;
  confidence?: number;
  rawLabel?: string;
  indicative?: boolean;
  source?: {
    page?: number;
    section?: string;
    snippet?: string;
  };
};

export type DocumentMetadataJson = Record<string, FieldValue>;

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),

    documentType: text("document_type"),
    dealType: text("deal_type"),
    profileId: text("profile_id"),

    lessor: text("lessor"),
    lessee: text("lessee"),
    seller: text("seller"),
    buyer: text("buyer"),
    counterparty: text("counterparty"),
    aircraftCount: integer("aircraft_count"),
    aircraftType: text("aircraft_type"),
    msn: text("msn"),
    registration: text("registration"),
    jurisdiction: text("jurisdiction"),
    term: text("term"),
    indicativeValue: text("indicative_value"),
    leaseType: text("lease_type"),
    effectiveDate: text("effective_date"),
    expiryDate: text("expiry_date"),
    monthlyRent: doublePrecision("monthly_rent"),
    currency: text("currency"),
    governingLaw: text("governing_law"),
    securityDeposit: text("security_deposit"),
    expectedDelivery: text("expected_delivery"),

    metadata: jsonb("metadata").$type<DocumentMetadataJson>().default({}),
    fullText: text("full_text"),

    documentEmbedding: vector("document_embedding"),

    extractionModel: text("extraction_model"),
    schemaVersion: text("schema_version"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_status_idx").on(table.status),
    index("documents_document_type_idx").on(table.documentType),
    index("documents_deal_type_idx").on(table.dealType),
    index("documents_lessor_idx").on(table.lessor),
    index("documents_lessee_idx").on(table.lessee),
    index("documents_msn_idx").on(table.msn),
    index("documents_counterparty_idx").on(table.counterparty),
    index("documents_expiry_date_idx").on(table.expiryDate),
  ]
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    heading: text("heading"),
    pageStart: integer("page_start"),
    embedding: vector("embedding"),
  },
  (table) => [
    index("document_chunks_document_id_idx").on(table.documentId),
  ]
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;

export type DealDocumentRole = "loi" | "ola";

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealReference: text("deal_reference"),
  dealType: text("deal_type"),
  lessor: text("lessor"),
  lessee: text("lessee"),
  seller: text("seller"),
  buyer: text("buyer"),
  msn: text("msn"),
  aircraftType: text("aircraft_type"),
  registration: text("registration"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dealDocuments = pgTable(
  "deal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    linkConfidence: doublePrecision("link_confidence"),
    linkSource: text("link_source").notNull().default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("deal_documents_deal_id_idx").on(table.dealId),
    index("deal_documents_document_id_idx").on(table.documentId),
  ]
);

export type Deal = typeof deals.$inferSelect;
export type DealDocument = typeof dealDocuments.$inferSelect;
