/**
 * Fisher Transform of RSI (FRSI) screener helpers.
 *
 * Ehlers' Fisher Transform makes a (roughly uniform) oscillator Gaussian, so its
 * turning points become sharp and distinct. Here it is fed the Wilder RSI of
 * closes instead of the median price — the same mechanic the repo's price Fisher
 * (`fisher.ts`) uses, applied one layer up:
 *
 *   rsi   = Wilder RSI(rsiPeriod) of closes                 // 0..100
 *   raw   = (rsi − minRSI) / (maxRSI − minRSI)              // 0..1 over the last N RSI values
 *   value = 0.66·(raw − 0.5) + 0.67·value_prev             // recursive, centred
 *   value = clamp(value, −0.999, 0.999)                    // keep the log finite
 *   fish  = 0.5·ln((1 + value) / (1 − value)) + 0.5·fish_prev
 *
 * Normalizing the RSI into its own recent range (rather than its fixed 0..100
 * bound) is what lets the Fisher reach its sharpening zone, and it screens for a
 * different thing than the plain RSI board: how *stretched* RSI is within its
 * recent swing, not its absolute level. The latest underlying RSI is reported
 * alongside so the absolute overbought/oversold read is never lost.
 *
 * The output is NOT bounded to ±1 — like every Fisher transform it saturates at
 * fixed but larger magnitudes (roughly ±3…±8), so it is coloured by sign, not by
 * a ±1 band. The trigger line is the prior bar's Fisher value; a turn relative to
 * it is a signal. Reuses `vrsi.ts`'s `wilderRsiSeries`; pure and synchronous so
 * the chain can be unit-tested against an independently verified fixture.
 */
import { wilderRsiSeries } from './vrsi';

export type FrsiCross = 'bull' | 'bear' | 'none';

export interface FrsiStats {
  /** Latest Fisher-of-RSI value (saturates near ±3…±8, not bounded to ±1). */
  fisher: number;
  /** Trigger line = the prior bar's Fisher value. */
  trigger: number;
  /** Fresh turn of the Fisher relative to its trigger on the latest bar. */
  cross: FrsiCross;
  /** Latest underlying Wilder RSI (0..100), for the absolute OB/OS context. */
  rsi: number;
  /** Number of closes supplied. */
  n: number;
}

export interface FrsiRow extends FrsiStats {
  symbol: string;
}

export type FrsiSort = 'fisher' | 'rsi' | 'symbol';

const clamp = (v: number) => (v > 0.999 ? 0.999 : v < -0.999 ? -0.999 : v);

/**
 * Compute the latest Fisher Transform of RSI for one symbol. Needs at least
 * `rsiPeriod + fisherPeriod` closes (one RSI series long enough for a single
 * normalization window); returns null otherwise. The trigger falls back to the
 * Fisher value itself when only one reading exists, and `cross` needs three.
 */
export function computeFrsi(closes: number[], rsiPeriod = 9, fisherPeriod = 9): FrsiStats | null {
  if (rsiPeriod < 1 || fisherPeriod < 1) return null;
  const R = wilderRsiSeries(closes, rsiPeriod);
  if (R.length < fisherPeriod) return null;

  const series: number[] = [];
  let value = 0;
  let fish = 0;
  for (let i = fisherPeriod - 1; i < R.length; i++) {
    let maxR = -Infinity;
    let minR = Infinity;
    for (let j = i - fisherPeriod + 1; j <= i; j++) {
      if (R[j] > maxR) maxR = R[j];
      if (R[j] < minR) minR = R[j];
    }
    const range = maxR - minR;
    const raw = range === 0 ? 0 : (R[i] - minR) / range;
    value = clamp(0.66 * (raw - 0.5) + 0.67 * value);
    fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
    series.push(fish);
  }

  const last = series.length - 1;
  const fisher = series[last];
  const trigger = last >= 1 ? series[last - 1] : fisher;

  let cross: FrsiCross = 'none';
  if (series.length >= 3) {
    const fPrev = series[last - 1];
    const fPrev2 = series[last - 2];
    if (fPrev <= fPrev2 && fisher > fPrev) cross = 'bull';
    else if (fPrev >= fPrev2 && fisher < fPrev) cross = 'bear';
  }

  return { fisher, trigger, cross, rsi: R[R.length - 1], n: closes.length };
}

/** Build a sorted per-symbol Fisher-of-RSI board, skipping symbols with too little history. */
export function frsiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: FrsiSort = 'fisher',
  rsiPeriod = 9,
  fisherPeriod = 9,
): FrsiRow[] {
  const rows: FrsiRow[] = [];
  for (const s of series) {
    const stats = computeFrsi(s.closes, rsiPeriod, fisherPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortFrsi(rows, sort);
}

export function sortFrsi(rows: FrsiRow[], sort: FrsiSort): FrsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'rsi':
      out.sort((a, b) => b.rsi - a.rsi);
      break;
    case 'fisher':
    default:
      out.sort((a, b) => b.fisher - a.fisher);
      break;
  }
  return out;
}
