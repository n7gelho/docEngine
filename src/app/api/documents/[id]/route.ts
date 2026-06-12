import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { deleteDocument } from "@/lib/documents/delete-document";
import { getDocumentById } from "@/lib/search/documents";
import { getDocumentDealRelations } from "@/lib/deals/relations";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const document = await getDocumentById(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const relations = await getDocumentDealRelations(id);
    const { fullText: _fullText, ...rest } = document;

    return NextResponse.json({
      ...rest,
      hasFullText: Boolean(document.fullText),
      textPreview: document.fullText?.slice(0, 2000) ?? null,
      deal: relations,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    await deleteDocument(id);
    return NextResponse.json({ message: "Document deleted." });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete document";
    const status = message === "Document not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
