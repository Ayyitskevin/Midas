/**
 * Tillson T3 moving-average slope/trend screener helpers.
 *
 * Tim Tillson's T3 (TASC, Jan 1998) is a very smooth, low-lag MA built by
 * nesting his "generalized DEMA" three times:
 *
 *   GD(x) = EMA(x, N)·(1 + v) − EMA(EMA(x, N), N)·v        (v = "volume factor")
 *   T3    = GD(GD(GD(price)))
 *
 * Because the EMA is linear and all six EMAs share period N, the triple nesting
 * collapses to a fixed combination of six chained EMAs (e1..e6 of close):
 *
 *   c1 = −v³,  c2 = 3v² + 3v³,  c3 = −6v² − 3v − 3v³,  c4 = 1 + 3v + v³ + 3v²
 *   T3 = c1·e6 + c2·e5 + c3·e4 + c4·e3
 *
 * The coefficients sum to 1 (unit DC gain — T3 of a constant is that constant);
 * at v = 1 the GD is Mulloy's DEMA, at v = 0 a plain EMA. Defaults are N = 5,
 * v = 0.7 (Tillson's values).
 *
 * The board screens by the T3's slope. The raw per-bar change is in price units
 * (not comparable across symbols), so — like the Hull-MA board — it sorts
 * cross-symbol on the scale-invariant percent slope
 *
 *   slopePct = 100 · (T3[last] − T3[prev]) / T3[prev]
 *
 * with the rising/falling direction from its sign. Reuses the repo's seeded
 * `emaSeries` for the whole chain (the polynomial form equals the nested-GD form
 * to machine precision only when every EMA shares that seeding). Pure and
 * synchronous; validated against an independently-reproduced fixture and the
 * constant-series fixed point (T3 of a constant = the constant).
 */
import { emaSeries } from './indicators';

export type T3Dir = 'up' | 'down' | 'flat';

/** Direction dead-band: treat |slopePct| below this as flat (numerical-zero guard). */
const EPS = 1e-9;

export interface T3Stats {
  /** Latest Tillson T3 value (price units). */
  t3: number;
  /** Scale-invariant percent slope: 100·(T3[last] − T3[prev]) / T3[prev]. */
  slopePct: number;
  /** Trend direction from the slope sign. */
  dir: T3Dir;
  /** Lookback period used for each EMA. */
  period: number;
  /** Number of closes supplied. */
  n: number;
}

export interface T3Row extends T3Stats {
  symbol: string;
}

export type T3Sort = 'slope' | 'symbol';

/**
 * Compute the latest Tillson T3 and its percent slope for one symbol. Needs at
 * least `6·period` closes so the six-deep EMA cascade has settled; returns null
 * on bad params or too little history.
 */
export function computeT3(closes: number[], period = 5, v = 0.7): T3Stats | null {
  if (period < 1 || v < 0) return null;
  const n = closes.length;
  if (n < 6 * period) return null;

  const e1 = emaSeries(closes, period);
  const e2 = emaSeries(e1, period);
  const e3 = emaSeries(e2, period);
  const e4 = emaSeries(e3, period);
  const e5 = emaSeries(e4, period);
  const e6 = emaSeries(e5, period);

  const v2 = v * v;
  const v3 = v2 * v;
  const c1 = -v3;
  const c2 = 3 * v2 + 3 * v3;
  const c3 = -6 * v2 - 3 * v - 3 * v3;
  const c4 = 1 + 3 * v + v3 + 3 * v2;
  const t3At = (i: number) => c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i];

  const t3 = t3At(n - 1);
  const prev = t3At(n - 2);
  const slopePct = prev !== 0 ? (100 * (t3 - prev)) / prev : 0;
  const dir: T3Dir = slopePct > EPS ? 'up' : slopePct < -EPS ? 'down' : 'flat';
  return { t3, slopePct, dir, period, n };
}

/** Build a sorted per-symbol T3 board, skipping symbols with too little history. */
export function t3Board(
  series: { symbol: string; closes: number[] }[],
  sort: T3Sort = 'slope',
  period = 5,
  v = 0.7,
): T3Row[] {
  const rows: T3Row[] = [];
  for (const s of series) {
    const stats = computeT3(s.closes, period, v);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortT3(rows, sort);
}

export function sortT3(rows: T3Row[], sort: T3Sort): T3Row[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
    default:
      // Strongest up-trends (most positive percent slope) first, deepest down last.
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
