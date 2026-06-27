/**
 * Connors RSI (Larry Connors).
 *
 * A short-term mean-reversion oscillator that averages three components, each
 * in [0, 100], so the result is too:
 *
 *   1. Wilder RSI of the close          (period 3) — classic price RSI
 *   2. Wilder RSI of the up/down streak (period 2) — momentum of the run length
 *   3. percent-rank of the 1-bar ROC    (period 100) — where today's return sits
 *
 *   CRSI = ( RSI(close,3) + RSI(streak,2) + percentRank(ROC,100) ) / 3
 *
 * The "streak" counts consecutive up days as +1, +2, +3… and down days as
 * −1, −2, −3…, resetting to 0 on an unchanged close. The percent-rank is the
 * share of the prior `rankPeriod` one-bar returns that sit strictly below
 * today's. Below 10 is washed-out (oversold), above 90 over-extended.
 *
 * Both RSI components mirror the app's shared Wilder rsi() exactly (SMA seed
 * over the first `period` deltas, then Wilder smoothing), so they agree with
 * the rest of the terminal. Verified component-by-component against an
 * independent worked example. Pure and synchronous.
 */

export type CrsiZone = 'ob' | 'os' | 'mid';

export interface CrsiStats {
  /** Connors RSI at the latest bar (0–100). */
  crsi: number;
  /** Component 1 — Wilder RSI of the close. */
  rsiClose: number;
  /** Component 2 — Wilder RSI of the up/down streak. */
  rsiStreak: number;
  /** Component 3 — percent-rank of the latest 1-bar ROC. */
  pctRank: number;
  /** > 90 overbought, < 10 oversold, otherwise mid. */
  zone: CrsiZone;
  /** Number of closes supplied. */
  n: number;
}

export interface CrsiRow extends CrsiStats {
  symbol: string;
}

export type CrsiSort = 'crsi' | 'symbol';

/**
 * Last Wilder RSI of a value series (SMA seed over the first `period` deltas,
 * then Wilder smoothing). Mirrors apps/web/src/lib/indicators.ts rsi(). Returns
 * null with too little data.
 */
function wilderRsiLast(values: number[], period: number): number | null {
  if (values.length <= period) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  let value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return value;
}

/** Consecutive up/down streak series: +1,+2,… on up days, −1,−2,… on down, 0 unchanged. */
function streakSeries(closes: number[]): number[] {
  const s: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) s.push(s[i - 1] > 0 ? s[i - 1] + 1 : 1);
    else if (closes[i] < closes[i - 1]) s.push(s[i - 1] < 0 ? s[i - 1] - 1 : -1);
    else s.push(0);
  }
  return s;
}

/**
 * Compute the latest Connors RSI for one symbol. Returns null with bad params
 * or too little history (needs ≥ rankPeriod + 2 closes so the percent-rank has
 * a full prior window).
 */
export function computeCrsi(
  closes: number[],
  rsiPeriod = 3,
  streakPeriod = 2,
  rankPeriod = 100,
): CrsiStats | null {
  if (rsiPeriod < 1 || streakPeriod < 1 || rankPeriod < 1) return null;
  if (closes.length < rankPeriod + 2) return null;

  const rsiClose = wilderRsiLast(closes, rsiPeriod);
  const rsiStreak = wilderRsiLast(streakSeries(closes), streakPeriod);
  if (rsiClose === null || rsiStreak === null) return null;

  // 1-bar ROC (% of the prior close), then percent-rank of the last value.
  const roc: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    roc.push(closes[i - 1] !== 0 ? ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100 : 0);
  }
  const last = roc.length - 1;
  const cur = roc[last];
  let below = 0;
  for (let i = last - rankPeriod; i < last; i++) {
    if (roc[i] < cur) below++;
  }
  const pctRank = (below / rankPeriod) * 100;

  const crsi = (rsiClose + rsiStreak + pctRank) / 3;
  const zone: CrsiZone = crsi > 90 ? 'ob' : crsi < 10 ? 'os' : 'mid';
  return { crsi, rsiClose, rsiStreak, pctRank, zone, n: closes.length };
}

/** Build a sorted per-symbol Connors RSI board, skipping symbols with too little history. */
export function crsiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: CrsiSort = 'crsi',
  rsiPeriod = 3,
  streakPeriod = 2,
  rankPeriod = 100,
): CrsiRow[] {
  const rows: CrsiRow[] = [];
  for (const s of series) {
    const stats = computeCrsi(s.closes, rsiPeriod, streakPeriod, rankPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCrsi(rows, sort);
}

export function sortCrsi(rows: CrsiRow[], sort: CrsiSort): CrsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'crsi':
    default:
      // Most overbought first.
      out.sort((a, b) => b.crsi - a.crsi);
      break;
  }
  return out;
}
