import type { LoiDraftContent } from "@/lib/generation/loi-draft-types";

export function computeDraftCompleteness(content: LoiDraftContent): {
  filledCount: number;
  totalCount: number;
  completenessPct: number;
} {
  let filledCount = 0;
  let totalCount = 0;

  for (const section of content.sections) {
    for (const field of section.fields) {
      totalCount++;
      const value = field.value?.trim();
      if (value) filledCount++;
    }
  }

  const completenessPct =
    totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  return { filledCount, totalCount, completenessPct };
}
