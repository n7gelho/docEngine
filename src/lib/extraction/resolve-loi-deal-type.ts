import type { DealType } from "@/lib/db/schema";
import { classifyDocumentHeuristic } from "@/lib/extraction/classify-document";

/**
 * Prefer document text when filename classification picked the wrong deal type
 * (e.g. loi_scenario_* defaulting to LEASE for a purchase LOI).
 */
export function resolveLoiDealType(
  classifiedDealType: DealType | undefined,
  extractionText: string,
  filename?: string
): DealType {
  const textHint = classifyDocumentHeuristic(extractionText, filename);
  if (!classifiedDealType) return textHint.dealType;
  if (classifiedDealType === textHint.dealType) return classifiedDealType;

  const sample = extractionText.slice(0, 18_000).toLowerCase();
  const purchaseLean =
    /letter of intent to purchase|intent to purchase|offer to purchase|to purchase aircraft/i.test(
      sample
    ) ||
    sample.includes("purchase price") ||
    ((sample.includes("buyer") || sample.includes("purchaser")) &&
      (sample.includes("seller") || sample.includes("vendor")));
  const leaseLean =
    (sample.includes("lessor") && sample.includes("lessee")) ||
    /operating lease|lease term|monthly rent/i.test(sample);

  if (purchaseLean && !leaseLean) return "PURCHASE";
  if (leaseLean && !purchaseLean) return "LEASE";
  return classifiedDealType;
}
