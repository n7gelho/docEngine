import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { assembleLoiDraft } from "@/lib/generation/assemble-loi-draft";
import {
  briefFromUnknownInput,
  getFilledBriefKeys,
} from "@/lib/retrieval/proforma-brief";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await initializeApp();
    const body = await request.json();
    const brief = briefFromUnknownInput(body.parameters ?? body.brief ?? body);

    if (getFilledBriefKeys(brief).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one proforma parameter to generate an LOI." },
        { status: 400 }
      );
    }

    const precedentDocumentIds = Array.isArray(body.precedentDocumentIds)
      ? body.precedentDocumentIds.filter(
          (id: unknown): id is string => typeof id === "string" && id.length > 0
        )
      : [];

    const templateOnly = Boolean(body.templateOnly);
    const projectTitle =
      typeof body.projectTitle === "string" ? body.projectTitle : undefined;

    const rawMatchScores = body.precedentMatchScores;
    const precedentMatchScores =
      typeof rawMatchScores === "object" && rawMatchScores !== null
        ? (Object.fromEntries(
            Object.entries(rawMatchScores as Record<string, unknown>).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number"
            )
          ) as Record<string, number>)
        : undefined;

    const assembled = await assembleLoiDraft({
      brief,
      precedentDocumentIds,
      projectTitle,
      templateOnly,
      precedentMatchScores,
    });

    const [draft] = await db
      .insert(loiDrafts)
      .values({
        title: assembled.content.documentTitle,
        brief,
        precedentDocumentIds: templateOnly ? [] : precedentDocumentIds,
        content: assembled.content,
        assemblyLog: assembled.assemblyLog,
        completenessPct: assembled.completenessPct,
        status: assembled.completenessPct >= 100 ? "complete" : "drafting",
      })
      .returning();

    return NextResponse.json({
      draftId: draft.id,
      title: draft.title,
      completenessPct: assembled.completenessPct,
      filledCount: assembled.filledCount,
      totalCount: assembled.totalCount,
      assemblyLog: assembled.assemblyLog,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LOI assembly failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
