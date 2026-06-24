/**
 * Tiny fuzzy matcher for the command palette. Case-insensitive subsequence
 * matching with scoring that rewards contiguous runs and word-boundary hits,
 * so "cor" ranks CORR above a scattered match. Pure and dependency-free.
 */

/**
 * Score how well `query` fuzzy-matches `text`. Higher is better; returns null
 * when `query` is not a subsequence of `text`. An empty query scores 0 (matches
 * everything), so callers can show a full list before the user types.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > t.length) return null;

  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    let found = -1;
    for (let j = from; j < t.length; j++) {
      if (t[j] === ch) {
        found = j;
        break;
      }
    }
    if (found === -1) return null;
    score += 1; // base point for the match
    if (found === prev + 1) score += 3; // contiguous run
    if (found === 0 || /[\s/_-]/.test(t[found - 1])) score += 2; // word boundary / start
    prev = found;
    from = found + 1;
  }
  // Nudge shorter targets ahead when scores otherwise tie.
  return score - text.length * 0.01;
}

/**
 * Rank `items` by the best fuzzy score of `query` across each item's candidate
 * strings (e.g. a command's code, aliases and title). Items that don't match at
 * all are dropped. An empty query returns the list unchanged (browsable).
 */
export function rankByFuzzy<T>(query: string, items: T[], candidates: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    let best: number | null = null;
    for (const c of candidates(item)) {
      const s = fuzzyScore(query, c);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best !== null) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.item);
}
