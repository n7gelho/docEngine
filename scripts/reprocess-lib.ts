import { loadEnvLocal } from "./load-env";
import {
  formatCoverageLine,
  listFilledMetadataKeys,
  parseCoverage,
} from "./lib/document-report";

export type ReprocessTarget = {
  id: string;
  filename: string;
  documentType?: string | null;
};

export async function loadReprocessTargets(
  filter: "all" | "ola" | string
): Promise<ReprocessTarget[]> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");

  if (filter.startsWith("id:")) {
    const id = filter.slice(3);
    const [row] = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        documentType: documents.documentType,
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!row) throw new Error(`Document not found: ${id}`);
    return [row];
  }

  const query = db
    .select({
      id: documents.id,
      filename: documents.filename,
      documentType: documents.documentType,
    })
    .from(documents)
    .orderBy(documents.createdAt);

  const rows =
    filter === "ola"
      ? await query.where(eq(documents.documentType, "OLA"))
      : await query;

  return rows;
}

async function printSummary(id: string, verbose: boolean): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");

  const [updated] = await db
    .select({
      extractionModel: documents.extractionModel,
      documentType: documents.documentType,
      dealType: documents.dealType,
      counterparty: documents.counterparty,
      aircraftType: documents.aircraftType,
      msn: documents.msn,
      governingLaw: documents.governingLaw,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!updated) return;

  console.log(`  type: ${updated.documentType} / ${updated.dealType}`);
  console.log(`  model: ${updated.extractionModel}`);
  console.log(`  counterparty: ${updated.counterparty ?? "—"}`);
  console.log(`  aircraft: ${updated.aircraftType ?? "—"}`);
  console.log(`  msn: ${updated.msn ?? "—"}`);
  console.log(`  governing law: ${updated.governingLaw ?? "—"}`);

  const coverage = parseCoverage(updated.metadata);
  if (coverage) {
    console.log(`  coverage: ${formatCoverageLine(coverage)}`);
    const warnings = coverage.warnings ?? [];
    if (warnings.length > 0) {
      console.log(
        `  warnings: ${warnings.slice(0, verbose ? 8 : 3).join("; ")}`
      );
    }
  }

  if (verbose) {
    const filled = listFilledMetadataKeys(updated.metadata);
    console.log(`  filled metadata keys (${filled.length}):`);
    for (const { key, value } of filled) {
      console.log(`    ${key}=${value.slice(0, 70)}`);
    }
  }
}

export async function runReprocess(
  filter: "all" | "ola" | string,
  verbose = false
): Promise<void> {
  loadEnvLocal();

  const { processDocument } = await import(
    "../src/lib/ingestion/process-document"
  );

  const targets = await loadReprocessTargets(filter);
  console.log(`Reprocessing ${targets.length} document(s)...\n`);

  for (const row of targets) {
    const label = row.documentType
      ? `${row.filename} (${row.documentType})`
      : row.filename;
    console.log(`--- ${label} ---`);
    const start = Date.now();
    await processDocument(row.id);
    await printSummary(row.id, verbose);
    console.log(`  time: ${((Date.now() - start) / 1000).toFixed(0)}s\n`);
  }
}
