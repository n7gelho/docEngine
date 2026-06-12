import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { findSimilarDocuments } from "@/lib/search/documents";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const limit = typeof body.limit === "number" ? body.limit : 10;
    const documentType =
      typeof body.documentType === "string" ? body.documentType : undefined;

    const results = await findSimilarDocuments({
      documentId: id,
      limit,
      documentType,
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Similarity search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
