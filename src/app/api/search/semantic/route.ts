import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { semanticSearch } from "@/lib/search/documents";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await initializeApp();
    const body = await request.json();

    if (!body.query || typeof body.query !== "string") {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const results = await semanticSearch({
      query: body.query,
      limit: typeof body.limit === "number" ? body.limit : 10,
      documentType:
        typeof body.documentType === "string" ? body.documentType : undefined,
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Semantic search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
