import { mkdir } from "fs/promises";
import path from "path";
import postgres from "postgres";
import { getEmbeddingDimensions } from "@/lib/ai/config";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function initializeApp() {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const dimensions = getEmbeddingDimensions();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        document_type TEXT,
        deal_type TEXT,
        profile_id TEXT,
        lessor TEXT,
        lessee TEXT,
        seller TEXT,
        buyer TEXT,
        counterparty TEXT,
        aircraft_count INTEGER,
        aircraft_type TEXT,
        msn TEXT,
        registration TEXT,
        jurisdiction TEXT,
        term TEXT,
        indicative_value TEXT,
        lease_type TEXT,
        effective_date TEXT,
        expiry_date TEXT,
        monthly_rent DOUBLE PRECISION,
        currency TEXT,
        governing_law TEXT,
        security_deposit TEXT,
        expected_delivery TEXT,
        metadata JSONB DEFAULT '{}',
        full_text TEXT,
        document_embedding vector(${dimensions}),
        extraction_model TEXT,
        schema_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        heading TEXT,
        page_start INTEGER,
        embedding vector(${dimensions})
      )
    `);
    await sql`CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status)`;
    await sql`CREATE INDEX IF NOT EXISTS documents_document_type_idx ON documents(document_type)`;
    await sql`CREATE INDEX IF NOT EXISTS documents_lessor_idx ON documents(lessor)`;
    await sql`CREATE INDEX IF NOT EXISTS documents_lessee_idx ON documents(lessee)`;
    await sql`CREATE INDEX IF NOT EXISTS documents_msn_idx ON documents(msn)`;
    await sql`CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks(document_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_reference TEXT,
        deal_type TEXT,
        lessor TEXT,
        lessee TEXT,
        seller TEXT,
        buyer TEXT,
        msn TEXT,
        aircraft_type TEXT,
        registration TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS deal_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        link_confidence DOUBLE PRECISION,
        link_source TEXT NOT NULL DEFAULT 'auto',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (document_id),
        UNIQUE (deal_id, role)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS deal_documents_deal_id_idx ON deal_documents(deal_id)`;
    await sql`CREATE INDEX IF NOT EXISTS deal_documents_document_id_idx ON deal_documents(document_id)`;

    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS deal_type TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS seller TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS buyer TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS aircraft_count INTEGER`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS counterparty TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS jurisdiction TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS term TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS indicative_value TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS security_deposit TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS expected_delivery TEXT`;
    await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_type TEXT`;
    await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS seller TEXT`;
    await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS buyer TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS documents_deal_type_idx ON documents(deal_type)`;
    await sql`CREATE INDEX IF NOT EXISTS documents_counterparty_idx ON documents(counterparty)`;
    await sql`
      CREATE TABLE IF NOT EXISTS loi_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        brief JSONB DEFAULT '{}',
        precedent_document_ids JSONB DEFAULT '[]',
        content JSONB NOT NULL,
        assembly_log JSONB DEFAULT '[]',
        completeness_pct INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'drafting',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS loi_drafts_status_idx ON loi_drafts(status)`;
  } finally {
    await sql.end();
  }
}

export function getUploadDir() {
  return path.resolve(UPLOAD_DIR);
}
