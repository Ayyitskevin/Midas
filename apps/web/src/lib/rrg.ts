/**
 * Relative Rotation Graph (RRG) math — a reproducible approximation of JdK
 * RS-Ratio / RS-Momentum. Relative strength is the asset / benchmark price
 * ratio; RS-Ratio is that ratio z-scored over a rolling window (centered at
 * 100), and RS-Momentum is the rolling z-score of the relative-strength
 * momentum (also centered at 100). Symbols rotate clockwise through the four
 * quadrants. Pure and side-effect free for unit testing.
 */

export type Quadrant = 'leading' | 'weakening' | 'lagging' | 'improving';

export interface RrgPoint {
  ratio: number;
  mom: number;
}

export interface RrgResult {
  symbol: string;
  ratio: number;
  mom: number;
  quadrant: Quadrant;
  /** Chronological trajectory (oldest → latest), up to the requested length. */
  tail: RrgPoint[];
}

/** Quadrant from an (RS-Ratio, RS-Momentum) pair, both centered at 100. */
export function quadrantOf(ratio: number, mom: number): Quadrant {
  if (ratio >= 100) return mom >= 100 ? 'leading' : 'weakening';
  return mom >= 100 ? 'improving' : 'lagging';
}

/**
 * Rolling population z-score: out[i] = (x[i] − mean) / std over the trailing
 * `window`. The warm-up region (and any window spanning a NaN) is NaN; a
 * zero-variance window yields 0.
 */
export function rollingZScore(xs: number[], window: number): number[] {
  const out = xs.map(() => NaN);
  if (window < 2) return out;
  for (let i = window - 1; i < xs.length; i++) {
    let m = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      if (!Number.isFinite(xs[j])) {
        ok = false;
        break;
      }
      m += xs[j];
    }
    if (!ok) continue;
    m /= window;
    let v = 0;
    for (let j = i - window + 1; j <= i; j++) v += (xs[j] - m) ** 2;
    const sd = Math.sqrt(v / window);
    out[i] = sd > 0 ? (xs[i] - m) / sd : 0;
  }
  return out;
}

/** Full RS-Ratio / RS-Momentum series (NaN through the warm-up). */
export function rrgSeries(asset: number[], bench: number[], window: number): RrgPoint[] {
  const n = Math.min(asset.length, bench.length);
  const a = asset.slice(-n);
  const b = bench.slice(-n);
  const rs = a.map((x, i) => (b[i] !== 0 && Number.isFinite(b[i]) ? x / b[i] : NaN));
  const roc = rs.map((v, i) => (i > 0 && rs[i - 1] !== 0 && Number.isFinite(rs[i - 1]) ? v / rs[i - 1] - 1 : NaN));
  const ratioZ = rollingZScore(rs, window);
  const momZ = rollingZScore(roc, window);
  return rs.map((_, i) => ({
    ratio: Number.isFinite(ratioZ[i]) ? 100 + ratioZ[i] : NaN,
    mom: Number.isFinite(momZ[i]) ? 100 + momZ[i] : NaN,
  }));
}

/**
 * RRG reading for one asset vs the benchmark: the latest (RS-Ratio,
 * RS-Momentum), its quadrant, and a trajectory tail. Null if there isn't
 * enough history to produce a finite point.
 */
export function rrgFor(
  symbol: string,
  asset: number[],
  bench: number[],
  window: number,
  tailLen: number,
): RrgResult | null {
  const finite = rrgSeries(asset, bench, window).filter(
    (p) => Number.isFinite(p.ratio) && Number.isFinite(p.mom),
  );
  if (finite.length === 0) return null;
  const tail = finite.slice(-Math.max(1, tailLen));
  const last = tail[tail.length - 1];
  return { symbol, ratio: last.ratio, mom: last.mom, quadrant: quadrantOf(last.ratio, last.mom), tail };
}
