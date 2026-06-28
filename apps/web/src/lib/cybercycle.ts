/**
 * Ehlers Cyber Cycle (CYBER) screener helpers.
 *
 * John Ehlers' Cyber Cycle oscillator (Cybernetic Analysis for Stocks and
 * Futures, 2004). It isolates the dominant cycle component of price with a
 * four-bar FIR smoother feeding a second-order recursive band-pass filter:
 *
 *   Price  = (high + low) / 2
 *   Smooth = (Price + 2·Price[1] + 2·Price[2] + Price[3]) / 6
 *   Cycle  = (1 − ½α)²·(Smooth − 2·Smooth[1] + Smooth[2])
 *          + 2(1 − α)·Cycle[1] − (1 − α)²·Cycle[2]
 *
 * with α = 0.07 by default. Ehlers' warm-up replaces the recursion on the first
 * six bars (EasyLanguage `CurrentBar < 7`, 1-based) with the simple second
 * difference (Price − 2·Price[1] + Price[2]) / 4; the full recursion begins on
 * the seventh bar (0-based index 6). The trigger is the prior bar's Cycle, so a
 * Cycle-vs-trigger cross marks a cyclic turn.
 *
 * The raw cycle is a band-passed price, so its amplitude scales with price; the
 * board reports it as a percent of price (cyclePct = 100·Cycle / Price) so it
 * ranks cleanly across symbols, alongside the scale-invariant turn cross.
 *
 * The construction (recursion coefficients, the (1,2,2,1)/6 smoother, the
 * 1-based warm-up boundary — a common off-by-one in Pine ports — and the
 * trigger) was confirmed against Ehlers' source and a machine-precision numeric
 * fixture by a multi-agent workflow. Pure and synchronous.
 */

/** Minimal bar (Cyber Cycle uses the median (high + low) / 2). */
export interface CyberCycleBar {
  high: number;
  low: number;
}

export type CyberCycleCross = 'bull' | 'bear' | 'none';

export interface CyberCycleStats {
  /** Latest Cycle as a percent of price (scale-invariant). */
  cyclePct: number;
  /** Trigger (prior bar's Cycle) as a percent of price. */
  trigPct: number;
  /** Fresh Cycle turn relative to its trigger on the latest bar. */
  cross: CyberCycleCross;
  /** Number of bars supplied. */
  n: number;
}

export interface CyberCycleRow extends CyberCycleStats {
  symbol: string;
}

export type CyberCycleSort = 'cycle' | 'symbol';

/**
 * Compute the latest Cyber Cycle reading for one symbol. Needs at least 8 bars
 * (so the recursion has spun up past its six-bar warm-up); returns null on bad
 * params or too little history.
 */
export function computeCyberCycle(bars: CyberCycleBar[], alpha = 0.07): CyberCycleStats | null {
  const n = bars.length;
  if (alpha <= 0 || n < 8) return null;

  const med = bars.map((b) => (b.high + b.low) / 2);
  const c1 = (1 - 0.5 * alpha) ** 2;
  const c2 = 2 * (1 - alpha);
  const c3 = (1 - alpha) ** 2;

  const smooth: number[] = [];
  for (let i = 0; i < n; i++) {
    smooth[i] = i >= 3 ? (med[i] + 2 * med[i - 1] + 2 * med[i - 2] + med[i - 3]) / 6 : NaN;
  }

  const cycle: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 6) {
      // Warm-up: simple second difference, missing priors clamped to the first price.
      const p1 = med[i - 1] ?? med[0];
      const p2 = med[i - 2] ?? med[0];
      cycle[i] = (med[i] - 2 * p1 + p2) / 4;
    } else {
      cycle[i] = c1 * (smooth[i] - 2 * smooth[i - 1] + smooth[i - 2]) + c2 * cycle[i - 1] - c3 * cycle[i - 2];
    }
  }

  const last = n - 1;
  const rawCycle = cycle[last];
  const rawTrig = cycle[last - 1];
  const m = med[last];
  const cyclePct = m === 0 ? 0 : (100 * rawCycle) / m;
  const trigPct = m === 0 ? 0 : (100 * rawTrig) / m;

  let cross: CyberCycleCross = 'none';
  const cPrev = cycle[last - 1];
  const cPrev2 = cycle[last - 2];
  if (cPrev <= cPrev2 && rawCycle > cPrev) cross = 'bull';
  else if (cPrev >= cPrev2 && rawCycle < cPrev) cross = 'bear';

  return { cyclePct, trigPct, cross, n };
}

/** Build a sorted per-symbol Cyber Cycle board, skipping symbols with too little history. */
export function cyberCycleBoard(
  series: { symbol: string; bars: CyberCycleBar[] }[],
  sort: CyberCycleSort = 'cycle',
  alpha = 0.07,
): CyberCycleRow[] {
  const rows: CyberCycleRow[] = [];
  for (const s of series) {
    const stats = computeCyberCycle(s.bars, alpha);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCyberCycle(rows, sort);
}

export function sortCyberCycle(rows: CyberCycleRow[], sort: CyberCycleSort): CyberCycleRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cycle':
    default:
      out.sort((a, b) => b.cyclePct - a.cyclePct);
      break;
  }
  return out;
}
