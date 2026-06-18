import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { buildSectionPortProposals } from "@/lib/generation/assemble-loi-draft";
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
        { error: "Provide at least one proforma parameter." },
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

    const preview = await buildSectionPortProposals({
      brief,
      precedentDocumentIds,
      projectTitle,
      templateOnly,
      precedentMatchScores,
    });

    return NextResponse.json(preview);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Section proposals failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
