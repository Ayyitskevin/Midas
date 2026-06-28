/**
 * Coral Trend Indicator (CORAL) screener helpers.
 *
 * LazyBear's Coral Trend Indicator (TradingView). A six-stage recursive EMA
 * cascade whose output is combined with Tillson-T3 weights, giving a very smooth,
 * low-lag trend line that flips colour on a change of slope:
 *
 *   di = (length − 1) / 2 + 1 ;  c1 = 2 / (di + 1) ;  c2 = 1 − c1
 *   i1..i6 = c1·src + c2·prev      // six chained EMAs, each ZERO-seeded (prev = 0 at start)
 *   coral  = −cd³·i6 + 3(cd²+cd³)·i5 − 3(2cd²+cd+cd³)·i4 + (3cd+1+cd³+3cd²)·i3
 *
 * The four weights sum to 1 and are exactly Tillson's T3 coefficients with v = cd
 * (see `t3.ts`); Coral differs from the T3 board only in its per-stage smoothing
 * constant (from `di`, not the raw length) and its zero-seeding. The trend is the
 * sign of coral − coral_prev: rising = up (green), falling = down (red), and a
 * change of that sign is a flip.
 *
 * Where the T3 board screens the line's slope, this board screens trend STATE:
 * direction, how many bars the current trend has held (age), fresh flips, and how
 * far price sits from the coral line (distPct, scale-invariant). The coral line
 * itself is in price units, so cross-symbol ranking uses distPct and signed age.
 *
 * Zero-seeding means the six-deep cascade needs ~6·di bars to shed its warm-up
 * bias toward 0; the 1-year daily history the board loads absorbs that. The exact
 * construction (di/c1, the T3-identical weights on i6/i5/i4/i3, zero-seeding, and
 * the flip rule) was confirmed against LazyBear's source and a machine-precision
 * numeric fixture by a multi-agent workflow. Pure and synchronous.
 */

export type CoralDir = 'up' | 'down';

export interface CoralStats {
  /** Latest Coral trend line (price units). */
  coral: number;
  /** Trend direction from coral vs the prior bar. */
  direction: CoralDir;
  /** Bars the current direction has held (1 = flipped on the latest bar). */
  age: number;
  /** Direction flipped on the latest bar. */
  flip: boolean;
  /** Close relative to the coral line, percent (scale-invariant). */
  distPct: number;
  /** Number of closes supplied. */
  n: number;
}

export interface CoralRow extends CoralStats {
  symbol: string;
}

export type CoralSort = 'trend' | 'dist' | 'symbol';

/**
 * Compute the latest Coral Trend reading for one symbol from a close series.
 * Needs at least 2 closes (for a direction); returns null on bad params or too
 * little history. Faithful to LazyBear's zero-seeded cascade, so on real data
 * allow ~6·di bars of warm-up (the board's 1-year history covers it).
 */
export function computeCoral(closes: number[], length = 21, cd = 0.4): CoralStats | null {
  const n = closes.length;
  if (length < 1 || cd <= 0 || n < 2) return null;

  const di = (length - 1) / 2 + 1;
  const c1 = 2 / (di + 1);
  const c2 = 1 - c1;
  const k6 = -(cd ** 3);
  const k5 = 3 * (cd ** 2 + cd ** 3);
  const k4 = -3 * (2 * cd ** 2 + cd + cd ** 3);
  const k3 = 3 * cd + 1 + cd ** 3 + 3 * cd ** 2;

  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  let i4 = 0;
  let i5 = 0;
  let i6 = 0;
  const bfr: number[] = [];
  for (let t = 0; t < n; t++) {
    const src = closes[t];
    i1 = c1 * src + c2 * i1;
    i2 = c1 * i1 + c2 * i2;
    i3 = c1 * i2 + c2 * i3;
    i4 = c1 * i3 + c2 * i4;
    i5 = c1 * i4 + c2 * i5;
    i6 = c1 * i5 + c2 * i6;
    bfr.push(k6 * i6 + k5 * i5 + k4 * i4 + k3 * i3);
  }

  // Direction per bar (t = 1..n−1); a flat step carries the prior direction.
  const dir: CoralDir[] = [];
  for (let t = 1; t < n; t++) {
    dir.push(bfr[t] > bfr[t - 1] ? 'up' : bfr[t] < bfr[t - 1] ? 'down' : dir[dir.length - 1] ?? 'up');
  }
  const direction = dir[dir.length - 1];
  let age = 1;
  for (let j = dir.length - 2; j >= 0; j--) {
    if (dir[j] === direction) age++;
    else break;
  }

  const coral = bfr[n - 1];
  const close = closes[n - 1];
  const distPct = coral === 0 ? 0 : (100 * (close - coral)) / coral;
  return { coral, direction, age, flip: age === 1, distPct, n };
}

/** Build a sorted per-symbol Coral Trend board, skipping symbols with too little history. */
export function coralBoard(
  series: { symbol: string; closes: number[] }[],
  sort: CoralSort = 'trend',
  length = 21,
  cd = 0.4,
): CoralRow[] {
  const rows: CoralRow[] = [];
  for (const s of series) {
    const stats = computeCoral(s.closes, length, cd);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCoral(rows, sort);
}

/** Signed trend persistence: +age while up, −age while down. */
const trendScore = (r: CoralStats) => (r.direction === 'up' ? r.age : -r.age);

export function sortCoral(rows: CoralRow[], sort: CoralSort): CoralRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dist':
      out.sort((a, b) => b.distPct - a.distPct);
      break;
    case 'trend':
    default:
      // Longest-running uptrends first, longest downtrends last; ties by distance.
      out.sort((a, b) => trendScore(b) - trendScore(a) || b.distPct - a.distPct);
      break;
  }
  return out;
}
