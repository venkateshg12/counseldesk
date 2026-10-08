export type Fused = { id: string; score: number };

/*
  Reciprocal Rank Fusion. Each list contributes 1 / (k + rank) for every id it contains (rank starts
  at 1); an id's score is the sum across lists. Only positions are used, never the original scores,
  so lists whose scores are on different scales can be merged.
 */
export const reciprocalRankFusion = (lists: string[][], k: number): Fused[] => {
  const scores = new Map<string, number>();

  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
};
