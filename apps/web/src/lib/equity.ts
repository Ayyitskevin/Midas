/**
 * Equity-curve / drawdown math for the trade journal — pure and offline. Given
 * the realized R-multiples of closed trades (each with a close time), it builds
 * the cumulative-R curve and the stats that summarize a track record: peak,
 * max drawdown, current and longest streaks.
 */

export interface RPoint {
  /** Close time (epoch ms), used to order the curve. */
  at: number;
  /** Realized R-multiple of the trade. */
  r: number;
}

export interface EquityPoint {
  at: number;
  r: number;
  /** Cumulative R through this trade. */
  cumR: number;
}

export type StreakType = 'win' | 'loss' | 'flat' | 'none';

export interface EquityCurve {
  points: EquityPoint[];
  totalR: number;
  /** Highest cumulative R reached (≥ 0; the curve starts at a 0 baseline). */
  peakR: number;
  /** Largest peak-to-trough drop in cumulative R (≥ 0). */
  maxDrawdownR: number;
  currentStreak: { type: StreakType; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  wins: number;
  losses: number;
}

const EPS = 1e-9;

function categorize(r: number): 'win' | 'loss' | 'flat' {
  return r > EPS ? 'win' : r < -EPS ? 'loss' : 'flat';
}

export function buildEquityCurve(input: readonly RPoint[]): EquityCurve {
  const sorted = [...input].sort((a, b) => a.at - b.at);

  const points: EquityPoint[] = [];
  let cumR = 0;
  let peak = 0; // baseline equity is 0, so an opening loss is already a drawdown
  let maxDD = 0;
  let runWin = 0;
  let runLoss = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let wins = 0;
  let losses = 0;

  for (const p of sorted) {
    cumR += p.r;
    if (cumR > peak) peak = cumR;
    const dd = peak - cumR;
    if (dd > maxDD) maxDD = dd;

    const c = categorize(p.r);
    if (c === 'win') {
      wins++;
      runWin++;
      runLoss = 0;
      if (runWin > longestWin) longestWin = runWin;
    } else if (c === 'loss') {
      losses++;
      runLoss++;
      runWin = 0;
      if (runLoss > longestLoss) longestLoss = runLoss;
    } else {
      runWin = 0;
      runLoss = 0;
    }

    points.push({ at: p.at, r: p.r, cumR });
  }

  let streakType: StreakType = 'none';
  let streakCount = 0;
  if (sorted.length > 0) {
    streakType = categorize(sorted[sorted.length - 1].r);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (categorize(sorted[i].r) === streakType) streakCount++;
      else break;
    }
  }

  return {
    points,
    totalR: cumR,
    peakR: peak,
    maxDrawdownR: maxDD,
    currentStreak: { type: streakType, count: streakCount },
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    wins,
    losses,
  };
}
