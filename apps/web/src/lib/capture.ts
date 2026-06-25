/**
 * Up / down capture vs a benchmark (here BTC) — how much of the benchmark's up
 * moves and down moves an asset participates in, the asymmetry that a single
 * symmetric beta hides. Days are split by the benchmark's direction; on up days
 * the upside capture is the asset's mean move over the benchmark's mean move,
 * and likewise for down days. The capture ratio (upside ÷ downside) rewards
 * names that catch more of the rallies than the sell-offs (ratio > 1).
 *
 * Because each side divides equal-count means, it simplifies to a sum ratio:
 * capture = Σ asset / Σ benchmark over that side's days. Pure for unit testing.
 */

import { toReturns } from './correlation';

export interface CaptureInput {
  symbol: string;
  closes: number[];
}

export interface CaptureStat {
  /** Upside capture (1 = matches benchmark on up days); null if undefined. */
  up: number | null;
  /** Downside capture (1 = matches benchmark on down days); null if undefined. */
  down: number | null;
  /** up / down — asymmetry; > 1 is favorable. Null when either side is missing. */
  ratio: number | null;
  upDays: number;
  downDays: number;
}

export interface CaptureRow extends CaptureStat {
  symbol: string;
}

export type CaptureSort = 'ratio' | 'up' | 'down' | 'symbol';

/** Capture stats of asset returns vs aligned benchmark returns. */
export function computeCapture(assetRet: number[], benchRet: number[]): CaptureStat {
  const n = Math.min(assetRet.length, benchRet.length);
  let assetUp = 0;
  let benchUp = 0;
  let assetDown = 0;
  let benchDown = 0;
  let upDays = 0;
  let downDays = 0;
  for (let i = 0; i < n; i++) {
    const b = benchRet[i];
    if (b > 0) {
      assetUp += assetRet[i];
      benchUp += b;
      upDays += 1;
    } else if (b < 0) {
      assetDown += assetRet[i];
      benchDown += b;
      downDays += 1;
    }
  }
  const up = upDays > 0 && benchUp !== 0 ? assetUp / benchUp : null;
  const down = downDays > 0 && benchDown !== 0 ? assetDown / benchDown : null;
  const ratio = up != null && down != null && down !== 0 ? up / down : null;
  return { up, down, ratio, upDays, downDays };
}

/**
 * Up/down capture board for a basket vs `benchmark`, on returns over the common
 * (trailing) overlap. The benchmark itself is omitted. Returns [] if the
 * benchmark series is missing.
 */
export function captureBoard(
  series: CaptureInput[],
  benchmark: string,
  sort: CaptureSort = 'ratio',
): CaptureRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: CaptureRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    rows.push({ symbol: s.symbol, ...computeCapture(toReturns(s.closes.slice(-k)), benchRet) });
  }
  return sortCapture(rows, sort);
}

export function sortCapture(rows: CaptureRow[], sort: CaptureSort): CaptureRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'up':
        return lo(b.up) - lo(a.up);
      case 'down':
        return lo(b.down) - lo(a.down);
      case 'ratio':
      default:
        return lo(b.ratio) - lo(a.ratio);
    }
  });
  return out;
}
