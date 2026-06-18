/** Field porting only from precedents within this gap of the best precedent score. */
export const FIELD_DONOR_PRECEDENT_GAP = 0.1;

export function computePrecedentScore(
  matchScore: number,
  suitabilityScore: number
): number {
  if (matchScore <= 0 || suitabilityScore <= 0) return 0;
  return (2 * matchScore * suitabilityScore) / (matchScore + suitabilityScore);
}

export function pickTopByPrecedentScore<T extends { id: string }>(
  items: T[],
  getPrecedentScore: (item: T) => number
): T | null {
  if (items.length === 0) return null;

  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = getPrecedentScore(item);
    if (!best || score > best.score) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

/** Restrict field donors to precedents close to the best overall precedent score. */
export function filterEligibleFieldDonors<T extends { id: string }>(
  precedents: T[],
  getPrecedentScore: (item: T) => number
): T[] {
  if (precedents.length <= 1) return precedents;

  const topScore = Math.max(...precedents.map(getPrecedentScore));
  const minAllowed = topScore - FIELD_DONOR_PRECEDENT_GAP;

  const eligible = precedents.filter((p) => getPrecedentScore(p) >= minAllowed);
  return eligible.length > 0 ? eligible : precedents.slice(0, 1);
}
