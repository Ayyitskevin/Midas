/**
 * Drawdown math from a close series: the decline from the running peak, the
 * worst (max) drawdown, the current drawdown, and how long the series has been
 * underwater (trailing, and the longest run). Pure for unit testing.
 */

export interface DrawdownStats {
  /** Drawdown fraction per point, peak-relative (≤ 0). */
  dd: number[];
  maxDD: number; // most-negative dd (0 if never below a peak)
  curDD: number; // latest dd
  underwater: number; // trailing periods below the peak (0 at a fresh high)
  longestUW: number; // longest underwater run
}

/** Peak-relative drawdown at each point: close / running-peak − 1. */
export function drawdownSeries(closes: number[]): number[] {
  const out: number[] = [];
  let peak = -Infinity;
  for (const c of closes) {
    if (c > peak) peak = c;
    out.push(peak > 0 ? c / peak - 1 : 0);
  }
  return out;
}

export function drawdownStats(closes: number[]): DrawdownStats {
  const dd = drawdownSeries(closes);
  let maxDD = 0;
  let longestUW = 0;
  let run = 0;
  for (const d of dd) {
    if (d < maxDD) maxDD = d;
    if (d < 0) {
      run += 1;
      if (run > longestUW) longestUW = run;
    } else {
      run = 0;
    }
  }
  let underwater = 0;
  for (let i = dd.length - 1; i >= 0; i--) {
    if (dd[i] < 0) underwater += 1;
    else break;
  }
  return { dd, maxDD, curDD: dd.length ? dd[dd.length - 1] : 0, underwater, longestUW };
}

export interface ClosesSeries {
  symbol: string;
  closes: number[];
}

export interface DrawdownRow extends DrawdownStats {
  symbol: string;
}

export type DrawdownSort = 'maxDD' | 'curDD' | 'underwater' | 'symbol';

/** Build a drawdown board (≥2 closes per symbol). */
export function drawdownBoard(series: ClosesSeries[], sort: DrawdownSort = 'maxDD'): DrawdownRow[] {
  const rows = series
    .filter((s) => s.closes.length >= 2)
    .map((s) => ({ symbol: s.symbol, ...drawdownStats(s.closes) }));
  return sortDrawdown(rows, sort);
}

export function sortDrawdown(rows: DrawdownRow[], sort: DrawdownSort): DrawdownRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'curDD':
        return a.curDD - b.curDD; // deepest (most negative) first
      case 'underwater':
        return b.underwater - a.underwater; // longest underwater first
      case 'maxDD':
      default:
        return a.maxDD - b.maxDD; // worst drawdown first
    }
  });
  return out;
}
