import { loadEnvLocal } from "./load-env";
import {
  formatCoverageLine,
  formatDealParametersLine,
  listDealParameterValues,
  listFilledMetadataKeys,
  parseCoverage,
} from "./lib/document-report";

loadEnvLocal();

const USAGE = `Usage:
  npx tsx scripts/diagnostics.ts classification [limit=5]
  npx tsx scripts/diagnostics.ts metadata [--ola]
  npx tsx scripts/diagnostics.ts deal-parameters [--ola]
  npx tsx scripts/diagnostics.ts ola-sections [documentId]`;

async function runClassification(limit: number) {
  const { desc } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");
  const {
    buildClassificationText,
    classifyDocumentHeuristic,
  } = await import("../src/lib/extraction/classify-document");
  const { buildExtractionText } = await import(
    "../src/lib/extraction/extraction-text"
  );
  const { parseDocument } = await import("../src/lib/parsing/parse-document");
  const { readStoredFile } = await import("../src/lib/storage/files");

  const rows = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .limit(limit);

  for (const doc of rows) {
    console.log("\n" + "=".repeat(70));
    console.log(`${doc.filename} (${doc.documentType ?? "?"})`);

    if (doc.status !== "ready" && doc.status !== "failed") {
      console.log("  status: still processing");
      continue;
    }

    const parsed = await parseDocument(
      await readStoredFile(doc.storageKey),
      doc.mimeType
    );
    const header = buildClassificationText(parsed);
    const extractionPreview = buildExtractionText(parsed);
    const classified = classifyDocumentHeuristic(header, doc.filename);
    const effectiveType =
      classified.documentType === "OTHER" ? "LOI" : classified.documentType;

    console.log(`  stored: ${doc.documentType} / ${doc.dealType}`);
    console.log(
      `  heuristic (header): ${classified.documentType} / ${classified.dealType}`
    );
    console.log(`  pipeline would use (heuristic only): ${effectiveType}`);
    console.log(`  note: live pipeline also runs LLM classification when AI is available`);
    console.log(`  header preview: ${header.slice(0, 200).replace(/\s+/g, " ")}`);
    console.log(
      `  extraction preview: ${extractionPreview.slice(0, 200).replace(/\s+/g, " ")}`
    );
  }
}

async function runMetadata(olaOnly: boolean) {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");

  const rows = olaOnly
    ? await db
        .select()
        .from(documents)
        .where(eq(documents.documentType, "OLA"))
    : await db.select().from(documents).orderBy(documents.createdAt);

  for (const row of rows) {
    console.log("\n" + "=".repeat(70));
    console.log(row.filename);
    console.log(`  type: ${row.documentType} / ${row.dealType}`);
    console.log(`  model: ${row.extractionModel ?? "—"}`);
    console.log(`  governing law: ${row.governingLaw ?? "—"}`);
    console.log(`  ${formatDealParametersLine(row.metadata)}`);

    const coverage = parseCoverage(row.metadata);
    if (coverage) {
      console.log(`  coverage: ${formatCoverageLine(coverage)}`);
      for (const w of coverage.warnings ?? []) console.log(`    - ${w}`);
    }

    for (const { key, value } of listFilledMetadataKeys(row.metadata)) {
      console.log(`  ${key}=${value.slice(0, 60)}`);
    }
  }
}

async function runDealParameters(olaOnly: boolean) {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");

  const rows = olaOnly
    ? await db
        .select()
        .from(documents)
        .where(eq(documents.documentType, "OLA"))
    : await db.select().from(documents).orderBy(documents.createdAt);

  for (const row of rows) {
    console.log("\n" + "=".repeat(70));
    console.log(row.filename);
    console.log(`  type: ${row.documentType} / ${row.dealType}`);
    console.log(`  ${formatDealParametersLine(row.metadata)}`);

    for (const { key, value } of listDealParameterValues(row.metadata)) {
      console.log(`  ${key}=${value.slice(0, 80)}`);
    }
  }
}

async function runOlaSections(documentId?: string) {
  const { eq, desc } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");
  const { parseDocument } = await import("../src/lib/parsing/parse-document");
  const { readStoredFile } = await import("../src/lib/storage/files");
  const { getOlaSectionTexts } = await import(
    "../src/lib/extraction/ola-section-windows"
  );

  const rows = documentId
    ? await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
    : await db
        .select()
        .from(documents)
        .where(eq(documents.documentType, "OLA"))
        .orderBy(desc(documents.createdAt));

  for (const doc of rows) {
    console.log("\n" + "=".repeat(70));
    console.log(doc.filename);
    const parsed = await parseDocument(
      await readStoredFile(doc.storageKey),
      doc.mimeType
    );
    console.log(`  text: ${parsed.fullText.length} chars, ${parsed.pages.length} pages`);

    for (const section of getOlaSectionTexts(parsed)) {
      console.log(
        `  ${section.sectionId}: located=${section.located} len=${section.text.length} preview="${section.text.slice(0, 100).replace(/\s+/g, " ")}"`
      );
    }
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    console.log(USAGE);
    process.exit(1);
  }

  switch (command) {
    case "classification":
      await runClassification(parseInt(rest[0] ?? "5", 10) || 5);
      break;
    case "metadata":
      await runMetadata(rest.includes("--ola"));
      break;
    case "deal-parameters":
      await runDealParameters(rest.includes("--ola"));
      break;
    case "ola-sections":
      await runOlaSections(rest[0]);
      break;
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
