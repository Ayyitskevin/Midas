/**
 * On-Balance Volume (OBV) / accumulation-trend analytics.
 *
 * OBV is a running total of signed volume: each bar adds +volume on an up
 * close, −volume on a down close, 0 when flat. A rising OBV means volume is
 * flowing in on up days (accumulation); a falling OBV means it's flowing out
 * on down days (distribution).
 *
 * Per symbol, over the last N bars (OBV reset to 0 at the window start so the
 * measures are comparable across names) we report:
 *   - obv       the latest OBV level (net signed volume over the window)
 *   - flow      (up − down) / (up + down) ∈ [−1, 1]: the net share of
 *               directional volume on up vs down days
 *   - slopePct  the OBV linear-regression slope per bar, as a % of average
 *               volume — the accumulation *trend* rate, robust to endpoints
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal close+volume bar. */
export interface ObvBar {
  close: number;
  volume: number;
}

export interface ObvStats {
  /** Latest OBV level over the window. */
  obv: number;
  /** Net directional-volume share ∈ [−1, 1]. */
  flow: number;
  /** OBV regression slope per bar, as a percentage of average volume. */
  slopePct: number;
  /** Total up-day volume. */
  up: number;
  /** Total down-day volume. */
  down: number;
  /** Number of transitions used. */
  n: number;
}

export interface ObvRow extends ObvStats {
  symbol: string;
}

export type ObvSort = 'slope' | 'flow' | 'obv' | 'symbol';

const MIN_BARS = 3;

/** Ordinary-least-squares slope of ys against its index 0..n-1. */
function regressionSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const y of ys) meanY += y;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Compute OBV / accumulation-trend stats for one symbol over the last `window`
 * bars (all bars when omitted). Returns null with too little history or no
 * directional volume (a name that never moved).
 */
export function computeObv(bars: ObvBar[], window?: number): ObvStats | null {
  if (bars.length < MIN_BARS) return null;
  const w = window && window > 0 && window < bars.length ? bars.slice(-window) : bars;
  if (w.length < MIN_BARS) return null;

  const series: number[] = [0];
  let up = 0;
  let down = 0;
  let volSum = 0;
  let volCount = 0;
  for (let i = 1; i < w.length; i++) {
    const v = w[i].volume;
    volSum += v;
    volCount += 1;
    const diff = w[i].close - w[i - 1].close;
    let signed = 0;
    if (diff > 0) {
      up += v;
      signed = v;
    } else if (diff < 0) {
      down += v;
      signed = -v;
    }
    series.push(series[series.length - 1] + signed);
  }

  const directional = up + down;
  if (directional <= 0) return null;

  const avgVol = volCount > 0 ? volSum / volCount : 0;
  const slope = regressionSlope(series);
  return {
    obv: series[series.length - 1],
    flow: (up - down) / directional,
    slopePct: avgVol > 0 ? (slope / avgVol) * 100 : 0,
    up,
    down,
    n: w.length - 1,
  };
}

/** Build a sorted per-symbol OBV board, skipping symbols with too little history. */
export function obvBoard(
  series: { symbol: string; bars: ObvBar[] }[],
  sort: ObvSort = 'slope',
  window?: number,
): ObvRow[] {
  const rows: ObvRow[] = [];
  for (const s of series) {
    const stats = computeObv(s.bars, window);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortObv(rows, sort);
}

export function sortObv(rows: ObvRow[], sort: ObvSort): ObvRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'flow':
      out.sort((a, b) => b.flow - a.flow);
      break;
    case 'obv':
      out.sort((a, b) => b.obv - a.obv);
      break;
    case 'slope':
    default:
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
