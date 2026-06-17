import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { findPrecedentDocuments } from "@/lib/retrieval/find-precedents";
import {
  briefFromUnknownInput,
  getFilledBriefKeys,
} from "@/lib/retrieval/proforma-brief";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await initializeApp();
    const body = await request.json();
    const brief = briefFromUnknownInput(body.parameters ?? body);

    if (getFilledBriefKeys(brief).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one proforma parameter to search." },
        { status: 400 }
      );
    }

    const results = await findPrecedentDocuments({
      brief,
      limit: typeof body.limit === "number" ? body.limit : 3,
      dealType:
        typeof body.dealType === "string" ? body.dealType : undefined,
      documentType:
        typeof body.documentType === "string" ? body.documentType : undefined,
    });

    return NextResponse.json({ brief, results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Precedent search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
