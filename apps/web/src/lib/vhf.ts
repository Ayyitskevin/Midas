/**
 * Vertical Horizontal Filter (Adam White, 1991).
 *
 * A trend-versus-chop regime gauge: it compares how far price has actually
 * travelled (the close range over N bars) against how much it wiggled to get
 * there (the summed bar-to-bar moves):
 *
 *   VHF = | highestClose(N) − lowestClose(N) | / Σ | close − prevClose |   over N
 *
 * Vertical (directional) movement over horizontal (back-and-forth) movement.
 * A strong trend covers ground efficiently → VHF high (toward 1); a choppy
 * range churns without progress → VHF low. Rising VHF means a strengthening
 * trend. Use trend-following tools when VHF is high (≳ 0.35) and oscillators
 * when it's low (≲ 0.20).
 *
 * Default look-back N = 28. Uses the CLOSE for both the range and the moves
 * (Adam White's definition), so it can be computed exactly from closes. Pure
 * and synchronous so it can be unit-tested with hand-computed series.
 */

export type VhfRegime = 'trend' | 'chop' | 'mid';
export type VhfDir = 'up' | 'down';

export interface VhfStats {
  /** Vertical Horizontal Filter at the latest bar (0–1). */
  vhf: number;
  /** VHF one bar back, for slope / direction. */
  prev: number;
  /** VHF rising (vhf ≥ prev) or falling. */
  dir: VhfDir;
  /** ≥ 0.35 trending, ≤ 0.20 choppy, otherwise mid. */
  regime: VhfRegime;
  /** Number of closes supplied. */
  n: number;
}

export interface VhfRow extends VhfStats {
  symbol: string;
}

export type VhfSort = 'vhf' | 'slope' | 'symbol';

const TREND = 0.35;
const CHOP = 0.2;

/** VHF over the N closes ending at `end` (needs close[end-period] for the first move). */
function vhfAt(closes: number[], end: number, period: number): number {
  const start = end - period + 1;
  let hcp = closes[start];
  let lcp = closes[start];
  let denom = 0;
  for (let k = start; k <= end; k++) {
    if (closes[k] > hcp) hcp = closes[k];
    if (closes[k] < lcp) lcp = closes[k];
    denom += Math.abs(closes[k] - closes[k - 1]);
  }
  return denom !== 0 ? Math.abs(hcp - lcp) / denom : 0;
}

/**
 * Compute the latest Vertical Horizontal Filter for one symbol. Returns null
 * with bad params or too little history (needs ≥ period + 1 closes so the
 * summed-moves window has a prior close for its first term).
 */
export function computeVhf(closes: number[], period = 28): VhfStats | null {
  if (period < 1) return null;
  const n = closes.length;
  if (n < period + 1) return null;

  const last = n - 1;
  const vhf = vhfAt(closes, last, period);
  const prev = last - 1 >= period ? vhfAt(closes, last - 1, period) : vhf;
  const regime: VhfRegime = vhf >= TREND ? 'trend' : vhf <= CHOP ? 'chop' : 'mid';
  return { vhf, prev, dir: vhf >= prev ? 'up' : 'down', regime, n };
}

/** Build a sorted per-symbol VHF board, skipping symbols with too little history. */
export function vhfBoard(
  series: { symbol: string; closes: number[] }[],
  sort: VhfSort = 'vhf',
  period = 28,
): VhfRow[] {
  const rows: VhfRow[] = [];
  for (const s of series) {
    const stats = computeVhf(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVhf(rows, sort);
}

export function sortVhf(rows: VhfRow[], sort: VhfSort): VhfRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.vhf - b.prev - (a.vhf - a.prev));
      break;
    case 'vhf':
    default:
      // Strongest trend first.
      out.sort((a, b) => b.vhf - a.vhf);
      break;
  }
  return out;
}
