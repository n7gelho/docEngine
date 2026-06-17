import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { computeDraftCompleteness } from "@/lib/generation/draft-completeness";
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

    return NextResponse.json({ draft });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const body = await request.json();

    const fieldKey = typeof body.fieldKey === "string" ? body.fieldKey : null;
    const value =
      body.value === null || body.value === undefined
        ? null
        : String(body.value).trim() || null;

    if (!fieldKey) {
      return NextResponse.json(
        { error: "fieldKey is required" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(loiDrafts)
      .where(eq(loiDrafts.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const content = existing.content as LoiDraftContent;
    let found = false;

    for (const section of content.sections) {
      for (const field of section.fields) {
        if (field.key === fieldKey) {
          field.value = value;
          field.source = "user";
          field.precedentDocumentId = null;
          field.precedentFilename = null;
          field.fieldScore = null;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }

    const { completenessPct, filledCount, totalCount } =
      computeDraftCompleteness(content);

    const [updated] = await db
      .update(loiDrafts)
      .set({
        content,
        completenessPct,
        status: completenessPct >= 100 ? "complete" : "drafting",
        updatedAt: new Date(),
      })
      .where(eq(loiDrafts.id, id))
      .returning();

    return NextResponse.json({
      draft: updated,
      filledCount,
      totalCount,
      completenessPct,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
