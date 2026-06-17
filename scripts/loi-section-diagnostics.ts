import { loadEnvLocal } from "./load-env";

loadEnvLocal();

function overlapRatio(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const shorter = A.length < B.length ? A : B;
  const longer = A.length < B.length ? B : A;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.7) {
    return shorter.length / longer.length;
  }
  return 0;
}

async function analyze(row: {
  id: string;
  filename: string;
  fullText: string | null;
  documentType: string | null;
  status: string;
}) {
  const { extractLoiSections, matchSectionByTitle, resolveDonorSection } =
    await import("../src/lib/generation/loi-section-extract");
  const { splitTextIntoSections } = await import(
    "../src/lib/extraction/select-extraction-pages"
  );

  console.log("\n" + "=".repeat(70));
  console.log(row.filename, "|", row.documentType, "|", row.status);
  const ft = row.fullText ?? "";
  console.log("fullText length:", ft.length);

  const blocks = splitTextIntoSections(ft);
  console.log("splitTextIntoSections blocks:", blocks.length);
  const usedWindows =
    blocks.length > 1 &&
    ft.length > 5000 &&
    blocks.every((b, i) => {
      const len = b.text.length;
      return len >= 3500 && len <= 5000;
    });
  if (usedWindows) console.log("  (likely window-split fallback — overlapping chunks)");

  const sections = extractLoiSections(ft);
  console.log("extractLoiSections count:", sections.length);
  for (const s of sections.slice(0, 15)) {
    console.log(
      `  [${s.index}] ${s.title.slice(0, 70)} | body=${s.bodyText.length} full=${s.fullText.length}`
    );
  }
  if (sections.length > 15) {
    console.log(`  ... +${sections.length - 15} more`);
  }

  let dupPairs = 0;
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const r = overlapRatio(sections[i].fullText, sections[j].fullText);
      if (r >= 0.85) {
        dupPairs++;
        console.log(
          `  DUPLICATE pair ${i},${j} overlap ${Math.round(r * 100)}% | "${sections[i].title.slice(0, 40)}" vs "${sections[j].title.slice(0, 40)}"`
        );
      }
    }
  }
  console.log("high-overlap pairs (>=85%):", dupPairs);

  const collisions = new Map<number, number[]>();
  for (const t of sections) {
    const matched = matchSectionByTitle(t.title, sections);
    const key = matched?.index ?? -1;
    const list = collisions.get(key) ?? [];
    list.push(t.index);
    collisions.set(key, list);
  }
  for (const [donorIdx, templateIndices] of collisions) {
    if (templateIndices.length > 1) {
      console.log(
        `  TITLE MAP COLLISION (old matcher): donor section ${donorIdx} <- template indices ${templateIndices.join(",")}`
      );
    }
  }

  const portTexts: string[] = [];
  for (const t of sections) {
    const resolved = resolveDonorSection(t, sections, { preferIndex: true });
    portTexts.push(resolved?.fullText.slice(0, 80) ?? "(null)");
  }
  const uniquePorts = new Set(portTexts);
  console.log(
    `simulate port (preferIndex): ${uniquePorts.size}/${sections.length} unique section openings`
  );
  if (uniquePorts.size < sections.length) {
    console.log("  WARNING: duplicate ported content still detected");
  }
}

async function main() {
  const { eq, desc } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { documents } = await import("../src/lib/db/schema");

  const documentId = process.argv[2];

  const rows = documentId
    ? await db
        .select({
          id: documents.id,
          filename: documents.filename,
          fullText: documents.fullText,
          documentType: documents.documentType,
          status: documents.status,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
    : await db
        .select({
          id: documents.id,
          filename: documents.filename,
          fullText: documents.fullText,
          documentType: documents.documentType,
          status: documents.status,
        })
        .from(documents)
        .where(eq(documents.documentType, "LOI"))
        .orderBy(desc(documents.createdAt))
        .limit(10);

  if (rows.length === 0) {
    console.log("No LOI documents found.");
    process.exit(0);
  }

  for (const row of rows) {
    await analyze(row);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
