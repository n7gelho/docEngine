import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import {
  renderLoiDraftText,
} from "@/lib/generation/assemble-loi-draft";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

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

    const text = renderLoiDraftText(draft.content as LoiDraftContent);

    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="loi-draft-${id.slice(0, 8)}.txt"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
