/**
 * Mass Index (Donald Dorsey).
 *
 * Watches the high-low range expand and contract to anticipate reversals,
 * via a ratio of single- to double-smoothed range, summed:
 *
 *   range = high − low
 *   ema1  = EMA(range, P),  ema2 = EMA(ema1, P)
 *   ratio = ema1 / ema2
 *   MI    = sum(ratio, sumPeriod)        (default P = 9, sumPeriod = 25)
 *
 * The "reversal bulge": MI rising above 27 then falling back below 26.5 warns a
 * trend is about to turn (direction taken from a separate trend filter). The
 * board reports the latest MI and a four-state machine: `bulge` (≥ 27),
 * `setup` (bulged earlier, awaiting the drop), `fired` (just dropped below 26.5
 * — the warning) or `normal`. A volatility-of-range signal, distinct from the
 * directional oscillators.
 *
 * Reuses the shared `emaSeries()` (first-value seed). Pure and synchronous for
 * exact unit testing. (The chained-EMA math and bulge state machine were
 * adversarially verified.)
 */
import { emaSeries } from './indicators';

/** Bar with high/low (Mass Index uses the range). */
export interface MassBar {
  high: number;
  low: number;
}

export type MassState = 'fired' | 'bulge' | 'setup' | 'normal';

export interface MassStats {
  /** Latest Mass Index value. */
  mass: number;
  /** Reversal-bulge state. */
  state: MassState;
  /** Number of bars supplied. */
  n: number;
}

export interface MassRow extends MassStats {
  symbol: string;
}

export type MassSort = 'mass' | 'symbol';

/**
 * Compute the latest Mass Index reading for one symbol. Needs `sumPeriod` bars;
 * returns null otherwise.
 */
export function computeMassIndex(
  bars: MassBar[],
  emaPeriod = 9,
  sumPeriod = 25,
  bulgeLevel = 27,
  triggerLevel = 26.5,
): MassStats | null {
  const n = bars.length;
  if (emaPeriod < 1 || sumPeriod < 1 || n < sumPeriod) return null;

  const range = bars.map((b) => b.high - b.low);
  const ema1 = emaSeries(range, emaPeriod);
  const ema2 = emaSeries(ema1, emaPeriod);
  const ratio = ema1.map((v, i) => (ema2[i] !== 0 ? v / ema2[i] : 1));

  // Rolling sum of the last `sumPeriod` ratios → the Mass Index series.
  const mi: number[] = [];
  for (let t = sumPeriod - 1; t < ratio.length; t++) {
    let s = 0;
    for (let j = t - sumPeriod + 1; j <= t; j++) s += ratio[j];
    mi.push(s);
  }
  if (mi.length === 0) return null;

  // Walk the bulge state machine; `fired` reflects only the final MI value.
  let setup = false;
  let fired = false;
  for (const v of mi) {
    fired = false;
    if (v >= bulgeLevel) setup = true;
    else if (setup && v < triggerLevel) {
      fired = true;
      setup = false;
    }
  }

  const mass = mi[mi.length - 1];
  const state: MassState = fired ? 'fired' : mass >= bulgeLevel ? 'bulge' : setup ? 'setup' : 'normal';
  return { mass, state, n };
}

/** Build a sorted per-symbol Mass Index board, skipping symbols with too little history. */
export function massBoard(
  series: { symbol: string; bars: MassBar[] }[],
  sort: MassSort = 'mass',
  emaPeriod = 9,
  sumPeriod = 25,
  bulgeLevel = 27,
  triggerLevel = 26.5,
): MassRow[] {
  const rows: MassRow[] = [];
  for (const s of series) {
    const stats = computeMassIndex(s.bars, emaPeriod, sumPeriod, bulgeLevel, triggerLevel);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortMass(rows, sort);
}

export function sortMass(rows: MassRow[], sort: MassSort): MassRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'mass':
    default:
      out.sort((a, b) => b.mass - a.mass);
      break;
  }
  return out;
}
