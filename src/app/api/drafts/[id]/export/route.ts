import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { renderLoiDraftText } from "@/lib/generation/assemble-loi-draft";
import {
  exportLoiDraft,
  formatExportWarnings,
  sanitizeHttpHeaderValue,
  type LoiExportFormat,
} from "@/lib/generation/export-loi-document";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";
import { briefFromUnknownInput } from "@/lib/retrieval/proforma-brief";

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
    const brief = briefFromUnknownInput(
      (draft.brief as Record<string, unknown>) ?? {}
    );
    const exported = await exportLoiDraft(content, format, renderLoiDraftText, {
      brief,
    });

    const headers: Record<string, string> = {
      "Content-Type": exported.mimeType,
      "Content-Disposition": `attachment; filename="${sanitizeHttpHeaderValue(exported.filename)}"`,
    };
    if (exported.validation.warnings.length > 0) {
      headers["X-Export-Warnings"] = formatExportWarnings(
        exported.validation.warnings
      );
      headers["X-Export-Completeness"] = String(
        exported.validation.completenessPct
      );
    }
    if (exported.pdfStrategy) {
      headers["X-Export-Strategy"] = exported.pdfStrategy;
    }

    return new NextResponse(new Uint8Array(exported.buffer), { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
