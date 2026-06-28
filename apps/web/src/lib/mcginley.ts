/**
 * McGinley Dynamic (MCG) screener helpers.
 *
 * John R. McGinley's Dynamic ("The Reliable Unknown Indicator") is a
 * self-adjusting moving average that automatically speeds up in declines and
 * slows down in advances, so it hugs price far more closely than a fixed-period
 * MA without the whipsaw:
 *
 *   md[0] = close[0]
 *   md[i] = md[i−1] + (close − md[i−1]) / ( N · (close / md[i−1])^4 )
 *
 * The adaptive denominator does the work: when price is above the line
 * (close/md > 1) the fourth power inflates the denominator so the line crawls
 * (it refuses to chase a rally); when price is below, the denominator shrinks so
 * the line catches the decline quickly. The constant is plain N (McGinley's
 * optional 0.6·N scaling, which makes it emulate an EMA, is not the default).
 *
 * The line is in price units, so the board screens scale-invariant readings: how
 * far price sits from the line (distPct) and the line's own slope (slopePct),
 * plus the up/down direction. A large positive distPct means price has stretched
 * above its adaptive baseline; the slope gives the underlying trend.
 *
 * The recursion uses the prior md OUTPUT (not the prior close — a known pandas-ta
 * quirk avoided here). Construction, the N-vs-0.6N constant, the ^4 power and the
 * close[0] seed were confirmed against the canonical sources and a
 * machine-precision numeric fixture by a multi-agent workflow. Pure and synchronous.
 */

export type McginleyDir = 'up' | 'down';

export interface McginleyStats {
  /** Latest McGinley Dynamic value (price units). */
  md: number;
  /** Prior-bar McGinley value. */
  prev: number;
  /** Close relative to the line, percent (scale-invariant). */
  distPct: number;
  /** Line slope over the last bar, percent (scale-invariant). */
  slopePct: number;
  /** Direction of the line on the latest bar. */
  direction: McginleyDir;
  /** Number of closes supplied. */
  n: number;
}

export interface McginleyRow extends McginleyStats {
  symbol: string;
}

export type McginleySort = 'dist' | 'slope' | 'symbol';

/**
 * Compute the latest McGinley Dynamic for one symbol from a close series. Needs
 * at least 2 closes (for a slope/direction); returns null on bad params or too
 * little history.
 */
export function computeMcginley(closes: number[], period = 14): McginleyStats | null {
  const n = closes.length;
  if (period < 1 || n < 2) return null;

  let md = closes[0];
  let prev = md;
  for (let i = 1; i < n; i++) {
    prev = md;
    const c = closes[i];
    if (md === 0) continue; // price MA never reaches 0 in practice; guard the division
    md = md + (c - md) / (period * (c / md) ** 4);
  }

  const close = closes[n - 1];
  const distPct = md === 0 ? 0 : (100 * (close - md)) / md;
  const slopePct = prev === 0 ? 0 : (100 * (md - prev)) / prev;
  const direction: McginleyDir = md >= prev ? 'up' : 'down';
  return { md, prev, distPct, slopePct, direction, n };
}

/** Build a sorted per-symbol McGinley Dynamic board, skipping symbols with too little history. */
export function mcginleyBoard(
  series: { symbol: string; closes: number[] }[],
  sort: McginleySort = 'dist',
  period = 14,
): McginleyRow[] {
  const rows: McginleyRow[] = [];
  for (const s of series) {
    const stats = computeMcginley(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortMcginley(rows, sort);
}

export function sortMcginley(rows: McginleyRow[], sort: McginleySort): McginleyRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
    case 'dist':
    default:
      // Most stretched above the line first, most below last.
      out.sort((a, b) => b.distPct - a.distPct);
      break;
  }
  return out;
}
