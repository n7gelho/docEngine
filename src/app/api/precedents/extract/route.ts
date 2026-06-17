import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { extractProformaBriefFromBuffer } from "@/lib/retrieval/extract-proforma";
import { detectMimeType } from "@/lib/parsing/parse-document";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    await initializeApp();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Only PDF and DOCX proforma files are supported." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = detectMimeType(file.name, file.type);
    const { brief, model } = await extractProformaBriefFromBuffer(
      buffer,
      mimeType
    );

    return NextResponse.json({
      filename: file.name,
      model,
      brief,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proforma extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
