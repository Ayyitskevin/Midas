/**
 * Variable Index Dynamic Average (VIDYA) screener helpers.
 *
 * Tushar Chande's VIDYA (the CMO-based "Chande VIDYA", from "The New Technical
 * Trader", 1994) is an EMA whose smoothing constant is scaled bar-by-bar by a
 * volatility index — the absolute Chande Momentum Oscillator — so the average
 * tracks fast in strong, directional moves and flattens in chop:
 *
 *   k     = |CMO(N)| / 100                     // 0…1 volatility index
 *   alpha = 2 / (N + 1)                        // the EMA constant for the same N
 *   VIDYA = alpha·k·close + (1 − alpha·k)·VIDYA_prev
 *
 * When |CMO| ≈ 100 (one-sided momentum) alpha·k ≈ alpha and VIDYA behaves like a
 * full EMA(N); when |CMO| ≈ 0 (balanced chop) alpha·k ≈ 0 and the line barely
 * moves. The CMO here is the repo's exact `cmo.ts` definition
 * ((ΣUp − ΣDown)/(ΣUp + ΣDown)·100, flat → 0) over N close-to-close changes; a
 * single period N drives both the CMO window and alpha. The series is seeded with
 * the SMA of the first N closes (the canonical seed — NOT the first close, which
 * belongs to the unrelated standard-deviation-ratio VIDYA lineage).
 *
 * The line is in price units, so the board screens scale-invariant readings: how
 * far price sits from the line (distPct), the line's slope (slopePct), and the
 * underlying CMO that drives the adaptation. Construction — CMO-vs-stddev variant,
 * the single shared period, the alpha·k scaling and the SMA seed — was confirmed
 * against the canonical sources and a machine-precision numeric fixture by a
 * multi-agent workflow (which corrected an initial first-close seed). Pure and
 * synchronous.
 */

export interface VidyaStats {
  /** Latest VIDYA value (price units). */
  vidya: number;
  /** Prior-bar VIDYA value. */
  prev: number;
  /** Close relative to the line, percent (scale-invariant). */
  distPct: number;
  /** Line slope over the last bar, percent (scale-invariant). */
  slopePct: number;
  /** Latest underlying CMO (−100…+100) — the volatility/momentum driving adaptation. */
  cmo: number;
  /** Number of closes supplied. */
  n: number;
}

export interface VidyaRow extends VidyaStats {
  symbol: string;
}

export type VidyaSort = 'dist' | 'slope' | 'cmo' | 'symbol';

/**
 * Compute the latest VIDYA for one symbol from a close series. Needs at least
 * `period + 1` closes (the SMA seed plus one CMO-defined bar); returns null on
 * bad params or too little history.
 */
export function computeVidya(closes: number[], period = 9): VidyaStats | null {
  const n = closes.length;
  if (period < 1 || n < period + 1) return null;

  const alpha = 2 / (period + 1);

  // Seed at index period−1 with the SMA of the first `period` closes.
  let seed = 0;
  for (let j = 0; j < period; j++) seed += closes[j];
  let vidya = seed / period;
  let prev = vidya;
  let lastCmo = 0;

  for (let i = period; i < n; i++) {
    // Rolling CMO over the `period` changes ending at bar i (mirrors cmo.ts).
    let up = 0;
    let down = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d > 0) up += d;
      else down += -d;
    }
    const total = up + down;
    const cmo = total === 0 ? 0 : ((up - down) / total) * 100;
    lastCmo = cmo;

    const k = Math.abs(cmo) / 100;
    prev = vidya;
    vidya = alpha * k * closes[i] + (1 - alpha * k) * vidya;
  }

  const close = closes[n - 1];
  const distPct = vidya === 0 ? 0 : (100 * (close - vidya)) / vidya;
  const slopePct = prev === 0 ? 0 : (100 * (vidya - prev)) / prev;
  return { vidya, prev, distPct, slopePct, cmo: lastCmo, n };
}

/** Build a sorted per-symbol VIDYA board, skipping symbols with too little history. */
export function vidyaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: VidyaSort = 'dist',
  period = 9,
): VidyaRow[] {
  const rows: VidyaRow[] = [];
  for (const s of series) {
    const stats = computeVidya(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVidya(rows, sort);
}

export function sortVidya(rows: VidyaRow[], sort: VidyaSort): VidyaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
    case 'cmo':
      out.sort((a, b) => b.cmo - a.cmo);
      break;
    case 'dist':
    default:
      // Most stretched above the line first, most below last.
      out.sort((a, b) => b.distPct - a.distPct);
      break;
  }
  return out;
}
