/**
 * Market-breadth oscillator — the share of a basket trading above its own
 * moving average, tracked over time. Price can be carried by a couple of mega-
 * caps while most names quietly roll over; breadth exposes that by counting how
 * many symbols actually sit above their N-day MA. High and rising is broad
 * strength (risk-on); low or falling while price holds up is a classic warning.
 *
 * Symbols are trailing-aligned to a common length, each symbol's rolling MA is
 * carried with a sliding sum, and at every step we tally the fraction above it.
 * Pure for unit testing.
 */

export interface BreadthPoint {
  /** Timestamp at this step. */
  time: number;
  /** Percent of symbols above their MA, 0–100. */
  pct: number;
  /** Count above. */
  above: number;
  /** Symbols counted. */
  total: number;
}

export interface Breadth {
  points: BreadthPoint[];
  current: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
}

const EMPTY: Breadth = { points: [], current: null, mean: null, min: null, max: null };

/**
 * Breadth time series: the percent of symbols whose close is above their
 * trailing `window`-day simple moving average. `closesBySymbol` are per-symbol
 * close series (trailing-aligned internally); `times` supplies the axis. Returns
 * an empty result without symbols or a window that fits the common length.
 */
export function breadth(closesBySymbol: number[][], times: number[], window: number): Breadth {
  const m = closesBySymbol.length;
  const w = Math.floor(window);
  if (m < 1 || w < 2) return EMPTY;
  const L = Math.min(times.length, ...closesBySymbol.map((c) => c.length));
  if (L < w) return EMPTY;

  const aligned = closesBySymbol.map((c) => c.slice(c.length - L));
  const ts = times.slice(times.length - L);

  const aboveAt = new Array(L).fill(0);
  for (let s = 0; s < m; s++) {
    const c = aligned[s];
    let sum = 0;
    for (let k = 0; k < w; k++) sum += c[k];
    for (let t = w - 1; t < L; t++) {
      if (t > w - 1) sum += c[t] - c[t - w];
      if (c[t] > sum / w) aboveAt[t] += 1;
    }
  }

  const points: BreadthPoint[] = [];
  for (let t = w - 1; t < L; t++) {
    points.push({ time: ts[t], pct: (aboveAt[t] / m) * 100, above: aboveAt[t], total: m });
  }
  if (points.length === 0) return EMPTY;

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    sum += p.pct;
    if (p.pct < min) min = p.pct;
    if (p.pct > max) max = p.pct;
  }
  return {
    points,
    current: points[points.length - 1].pct,
    mean: sum / points.length,
    min,
    max,
  };
}
