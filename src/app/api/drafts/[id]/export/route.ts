import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { renderLoiDraftText } from "@/lib/generation/assemble-loi-draft";
import {
  exportLoiDraft,
  type LoiExportFormat,
} from "@/lib/generation/export-loi-document";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseExportFormat(value: string | null): LoiExportFormat {
  if (value === "docx" || value === "pdf" || value === "txt") return value;
  return "pdf";
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await initializeApp();
    const { id } = await context.params;
    const format = parseExportFormat(
      request.nextUrl.searchParams.get("format")
    );

    const [draft] = await db
      .select()
      .from(loiDrafts)
      .where(eq(loiDrafts.id, id))
      .limit(1);

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const content = draft.content as LoiDraftContent;
    const exported = await exportLoiDraft(content, format, renderLoiDraftText);

    return new NextResponse(new Uint8Array(exported.buffer), {
      headers: {
        "Content-Type": exported.mimeType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
