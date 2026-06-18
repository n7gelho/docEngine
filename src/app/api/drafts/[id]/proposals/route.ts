import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { buildSectionPortProposals } from "@/lib/generation/assemble-loi-draft";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";
import type { ProformaBrief } from "@/lib/retrieval/proforma-brief";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const [draft] = await db
      .select()
      .from(loiDrafts)
      .where(eq(loiDrafts.id, id))
      .limit(1);

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const content = draft.content as LoiDraftContent;

    if (!draft.precedentDocumentIds || draft.precedentDocumentIds.length === 0) {
      return NextResponse.json({
        proposals: [],
        templateDocumentId: content.templateDocumentId ?? null,
        templateFilename: content.templateFilename ?? null,
      });
    }

    const preview = await buildSectionPortProposals({
      brief: draft.brief as ProformaBrief,
      precedentDocumentIds: draft.precedentDocumentIds,
      projectTitle: draft.title,
    });

    return NextResponse.json({
      proposals: preview.proposals,
      templateDocumentId: preview.templateDocumentId,
      templateFilename: preview.templateFilename,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load proposals";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
