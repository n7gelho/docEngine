import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { processDocument } from "@/lib/ingestion/process-document";
import { getDocumentById } from "@/lib/search/documents";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const document = await getDocumentById(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await processDocument(id);
    const updated = await getDocumentById(id);
    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reprocess document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
