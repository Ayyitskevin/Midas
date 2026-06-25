/**
 * Kaufman's Efficiency Ratio — the signal-to-noise of a move. Over a window it
 * is the net price change divided by the total distance actually travelled
 * (the sum of bar-to-bar moves). A clean one-way trend has ER near 1 (every
 * step contributed to the net move); a choppy, going-nowhere tape has ER near 0
 * (lots of motion, little progress). It says nothing about direction or size on
 * its own, so we carry the net change's sign and percent alongside it.
 *
 * Pure and side-effect free for unit testing.
 */

export interface EfficiencyRow {
  symbol: string;
  /** Efficiency ratio in [0, 1]. */
  er: number;
  /** Sign of the net change over the window: +1 up, −1 down, 0 flat. */
  direction: number;
  /** Net percent change over the window. */
  changePct: number;
  /** Periods used. */
  n: number;
}

export type EfficiencySort = 'er' | 'change' | 'symbol';

export interface EfficiencyInput {
  symbol: string;
  closes: number[];
}

/**
 * Efficiency ratio of a close series over the trailing `window` periods (uses
 * window+1 closes). Returns null when there isn't enough history. A flat path
 * (zero distance travelled) reports ER 0.
 */
export function computeEfficiency(
  closes: number[],
  window: number,
): Omit<EfficiencyRow, 'symbol'> | null {
  const w = Math.floor(window);
  if (w < 1 || closes.length < w + 1) return null;
  const slice = closes.slice(-(w + 1));
  const first = slice[0];
  const last = slice[slice.length - 1];
  const net = last - first;
  let path = 0;
  for (let i = 1; i < slice.length; i++) path += Math.abs(slice[i] - slice[i - 1]);
  const er = path > 0 ? Math.abs(net) / path : 0;
  const changePct = first !== 0 ? (last / first - 1) * 100 : 0;
  return { er, direction: Math.sign(net), changePct, n: w };
}

/** Efficiency-ratio board across a basket, sorted (default ER descending). */
export function efficiencyBoard(
  series: EfficiencyInput[],
  window: number,
  sort: EfficiencySort = 'er',
): EfficiencyRow[] {
  const rows: EfficiencyRow[] = [];
  for (const s of series) {
    const r = computeEfficiency(s.closes, window);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortEfficiency(rows, sort);
}

export function sortEfficiency(rows: EfficiencyRow[], sort: EfficiencySort): EfficiencyRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'change':
        return b.changePct - a.changePct;
      case 'er':
      default:
        return b.er - a.er;
    }
  });
  return out;
}
