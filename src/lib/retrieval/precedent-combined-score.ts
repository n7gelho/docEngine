/** Balanced blend: deal similarity + template suitability. */
export const COMBINED_SIMILAR_WEIGHT = 0.55;
export const COMBINED_TEMPLATE_WEIGHT = 0.45;

/** Field porting only from precedents within this gap of the best combined score. */
export const FIELD_DONOR_COMBINED_GAP = 0.1;

export function computeCombinedScore(
  matchScore: number,
  templateFitness: number
): number {
  return (
    COMBINED_SIMILAR_WEIGHT * matchScore +
    COMBINED_TEMPLATE_WEIGHT * templateFitness
  );
}

export function pickTopByCombinedScore<T extends { id: string }>(
  items: T[],
  getCombined: (item: T) => number
): T | null {
  if (items.length === 0) return null;

  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = getCombined(item);
    if (!best || score > best.score) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

/** Restrict field donors to precedents close to the best overall combined score. */
export function filterEligibleFieldDonors<T extends { id: string }>(
  precedents: T[],
  getCombined: (item: T) => number
): T[] {
  if (precedents.length <= 1) return precedents;

  const topScore = Math.max(...precedents.map(getCombined));
  const minAllowed = topScore - FIELD_DONOR_COMBINED_GAP;

  const eligible = precedents.filter((p) => getCombined(p) >= minAllowed);
  return eligible.length > 0 ? eligible : precedents.slice(0, 1);
}
