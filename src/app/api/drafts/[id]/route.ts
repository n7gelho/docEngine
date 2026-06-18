import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { initializeApp } from "@/lib/init";
import { db } from "@/lib/db";
import { loiDrafts } from "@/lib/db/schema";
import { computeDraftCompleteness } from "@/lib/generation/draft-completeness";
import {
  collectFieldKeys,
  createUserField,
  primaryBodySection,
  removeFieldByKey,
} from "@/lib/generation/draft-field-utils";
import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

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
    const label =
      body.label === null || body.label === undefined
        ? null
        : String(body.label).trim() || null;

    const [existing] = await db
      .select()
      .from(loiDrafts)
      .where(eq(loiDrafts.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const content = existing.content as LoiDraftContent;
    let updated = false;

    if (body.documentTitle !== undefined) {
      const nextTitle = normalizeOptionalString(body.documentTitle);
      if (nextTitle) {
        content.documentTitle = nextTitle;
        updated = true;
      }
    }

    if (body.letterheadTitle !== undefined) {
      content.letterheadTitle =
        normalizeOptionalString(body.letterheadTitle) ?? "LETTER OF INTENT";
      updated = true;
    }

    const deleteFieldKey =
      typeof body.deleteFieldKey === "string" ? body.deleteFieldKey : null;
    if (deleteFieldKey) {
      if (!removeFieldByKey(content, deleteFieldKey)) {
        return NextResponse.json({ error: "Field not found" }, { status: 404 });
      }
      updated = true;
    }

    const addField =
      body.addField &&
      typeof body.addField === "object" &&
      !Array.isArray(body.addField)
        ? (body.addField as { label?: unknown; value?: unknown; afterKey?: unknown })
        : null;
    if (addField) {
      const label = normalizeOptionalString(addField.label);
      if (!label) {
        return NextResponse.json(
          { error: "addField.label is required" },
          { status: 400 }
        );
      }

      const section = primaryBodySection(content);
      if (!section) {
        content.sections.push({
          id: "document_body",
          title: "Document body",
          fields: [],
        });
      }
      const target = primaryBodySection(content)!;
      const keys = collectFieldKeys(content);
      const field = createUserField(label, {
        value:
          addField.value === null || addField.value === undefined
            ? null
            : String(addField.value).trim() || null,
        existingKeys: keys,
      });

      const afterKey =
        typeof addField.afterKey === "string" ? addField.afterKey : null;
      if (afterKey) {
        const afterIndex = target.fields.findIndex((f) => f.key === afterKey);
        if (afterIndex >= 0) {
          target.fields.splice(afterIndex + 1, 0, field);
        } else {
          target.fields.push(field);
        }
      } else {
        target.fields.push(field);
      }

      updated = true;
    }

    if (fieldKey) {
      let found = false;

      for (const section of content.sections) {
        for (const field of section.fields) {
          if (field.key === fieldKey) {
            if (body.value !== undefined) {
              field.value = value;
              field.source = "user";
              field.precedentDocumentId = null;
              field.precedentFilename = null;
              field.fieldScore = null;
              updated = true;
            }
            if (label) {
              field.label = label;
              field.source = "user";
              updated = true;
            }
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        return NextResponse.json({ error: "Field not found" }, { status: 404 });
      }
    }

    if (!updated) {
      return NextResponse.json(
        { error: "No supported fields to update" },
        { status: 400 }
      );
    }

    const { completenessPct, filledCount, totalCount } =
      computeDraftCompleteness(content);

    const [saved] = await db
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
      draft: saved,
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
