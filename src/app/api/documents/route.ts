import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import {
  ingestUploadedFile,
  summarizeBatchResults,
} from "@/lib/ingestion/ingest-upload";
import { listDocuments, type DocumentFilters } from "@/lib/search/documents";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseFilters(searchParams: URLSearchParams): DocumentFilters {
  const ids = searchParams.getAll("ids").filter(Boolean);
  const olaSections: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith("olaSection_") && value.trim()) {
      olaSections[key.replace("olaSection_", "")] = value;
    }
  }

  return {
    documentType: searchParams.get("documentType") ?? undefined,
    dealType: searchParams.get("dealType") ?? undefined,
    counterparty: searchParams.get("counterparty") ?? undefined,
    term: searchParams.get("term") ?? undefined,
    jurisdiction: searchParams.get("jurisdiction") ?? undefined,
    indicativeValue: searchParams.get("indicativeValue") ?? undefined,
    olaSections: Object.keys(olaSections).length > 0 ? olaSections : undefined,
    lessor: searchParams.get("lessor") ?? undefined,
    lessee: searchParams.get("lessee") ?? undefined,
    seller: searchParams.get("seller") ?? undefined,
    buyer: searchParams.get("buyer") ?? undefined,
    aircraftType: searchParams.get("aircraftType") ?? undefined,
    msn: searchParams.get("msn") ?? undefined,
    registration: searchParams.get("registration") ?? undefined,
    leaseType: searchParams.get("leaseType") ?? undefined,
    governingLaw: searchParams.get("governingLaw") ?? undefined,
    currency: searchParams.get("currency") ?? undefined,
    aircraftCount: searchParams.get("aircraftCount")
      ? Number(searchParams.get("aircraftCount"))
      : undefined,
    effectiveDateFrom: searchParams.get("effectiveDateFrom") ?? undefined,
    effectiveDateTo: searchParams.get("effectiveDateTo") ?? undefined,
    expiryDateFrom: searchParams.get("expiryDateFrom") ?? undefined,
    expiryDateTo: searchParams.get("expiryDateTo") ?? undefined,
    monthlyRentMin: searchParams.get("monthlyRentMin")
      ? Number(searchParams.get("monthlyRentMin"))
      : undefined,
    monthlyRentMax: searchParams.get("monthlyRentMax")
      ? Number(searchParams.get("monthlyRentMax"))
      : undefined,
    status: searchParams.get("status") ?? undefined,
    ids: ids.length > 0 ? ids : undefined,
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit")
      ? Number(searchParams.get("limit"))
      : undefined,
    offset: searchParams.get("offset")
      ? Number(searchParams.get("offset"))
      : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    await initializeApp();
    const filters = parseFilters(request.nextUrl.searchParams);
    const result = await listDocuments(filters);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list documents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeApp();
    const formData = await request.formData();

    const multiFiles = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const singleFile = formData.get("file");
    const files =
      multiFiles.length > 0
        ? multiFiles
        : singleFile instanceof File
          ? [singleFile]
          : [];

    if (files.length === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const results = await Promise.all(files.map((file) => ingestUploadedFile(file)));

    if (files.length === 1) {
      const result = results[0];
      if (result.status === "failed") {
        return NextResponse.json({ error: result.message }, { status: 500 });
      }
      if (result.status === "skipped") {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }

      return NextResponse.json(
        {
          documentId: result.documentId,
          duplicate: result.duplicate,
          message: result.message,
        },
        { status: 202 }
      );
    }

    const summary = summarizeBatchResults(results);
    return NextResponse.json(summary, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
