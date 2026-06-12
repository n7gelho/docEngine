import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import {
  getDocumentDealRelations,
  linkDocumentsToDeal,
  unlinkDocumentFromDeal,
} from "@/lib/deals/relations";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const relations = await getDocumentDealRelations(id);
    return NextResponse.json(relations);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch related documents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const body = await request.json();

    if (!body.targetDocumentId || typeof body.targetDocumentId !== "string") {
      return NextResponse.json(
        { error: "targetDocumentId is required" },
        { status: 400 }
      );
    }

    const result = await linkDocumentsToDeal(id, body.targetDocumentId, {
      source: "manual",
    });
    const relations = await getDocumentDealRelations(id);

    return NextResponse.json({
      dealId: result.dealId,
      deal: relations,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to link documents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    await unlinkDocumentFromDeal(id);
    const relations = await getDocumentDealRelations(id);
    return NextResponse.json(relations);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to unlink document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
