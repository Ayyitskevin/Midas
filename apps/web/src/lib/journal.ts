/**
 * Trade-journal analytics — pure and offline. A trade records its entry, its
 * initial stop (which defines 1R of risk) and, once closed, its exit. From
 * those we derive the realized R-multiple and outcome per trade, then roll the
 * book up into the numbers that actually matter: win rate, expectancy (average
 * R), profit factor and total R.
 */

export type TradeSide = 'long' | 'short';

export interface JournalTrade {
  id: string;
  symbol: string;
  side: TradeSide;
  entry: number;
  /** Initial stop — the distance entry→stop is 1R. */
  stop: number;
  /** Exit price; null while the trade is open. */
  exit: number | null;
  /** Optional position size, for dollar P&L. */
  size: number | null;
  openedAt: number;
  closedAt: number | null;
  note: string;
}

export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'open';

export interface DerivedTrade {
  /** Per-unit risk: |entry − stop|. */
  riskPerUnit: number;
  /** Realized R-multiple; null while open or when risk is undefined. */
  rMultiple: number | null;
  /** Dollar P&L when a size is set and the trade is closed. */
  pnl: number | null;
  outcome: TradeOutcome;
}

const EPS = 1e-9;

export function deriveTrade(t: JournalTrade): DerivedTrade {
  const dir = t.side === 'long' ? 1 : -1;
  const riskPerUnit = Math.abs(t.entry - t.stop);

  if (t.exit == null) {
    return { riskPerUnit, rMultiple: null, pnl: null, outcome: 'open' };
  }

  const rMultiple = riskPerUnit > 0 ? (dir * (t.exit - t.entry)) / riskPerUnit : null;
  const pnl = t.size != null && t.size > 0 ? dir * (t.exit - t.entry) * t.size : null;

  let outcome: TradeOutcome = 'breakeven';
  const signal = rMultiple ?? pnl;
  if (signal != null) {
    if (signal > EPS) outcome = 'win';
    else if (signal < -EPS) outcome = 'loss';
  }

  return { riskPerUnit, rMultiple, pnl, outcome };
}

export interface JournalStats {
  total: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  /** Wins / decided (excludes break-evens); null with no decided trades. */
  winRate: number | null;
  /** Expectancy — average R across trades with a defined R. */
  avgR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Gross winning R / gross losing R; null without losses. */
  profitFactor: number | null;
  totalR: number;
  /** Sum of dollar P&L where sizes are set; null if none are. */
  totalPnl: number | null;
}

export function computeStats(trades: JournalTrade[]): JournalStats {
  let closed = 0;
  let open = 0;
  let wins = 0;
  let losses = 0;
  let rCount = 0;
  let totalR = 0;
  let sumWinR = 0;
  let sumLossR = 0;
  let posR = 0;
  let negR = 0;
  let totalPnl = 0;
  let pnlCount = 0;

  for (const t of trades) {
    const d = deriveTrade(t);
    if (d.outcome === 'open') {
      open++;
      continue;
    }
    closed++;
    if (d.pnl != null) {
      totalPnl += d.pnl;
      pnlCount++;
    }
    if (d.rMultiple == null) continue;
    rCount++;
    totalR += d.rMultiple;
    if (d.rMultiple > EPS) {
      wins++;
      sumWinR += d.rMultiple;
      posR += d.rMultiple;
    } else if (d.rMultiple < -EPS) {
      losses++;
      sumLossR += d.rMultiple;
      negR += d.rMultiple;
    }
  }

  const decided = wins + losses;
  return {
    total: trades.length,
    closed,
    open,
    wins,
    losses,
    winRate: decided > 0 ? wins / decided : null,
    avgR: rCount > 0 ? totalR / rCount : null,
    avgWinR: wins > 0 ? sumWinR / wins : null,
    avgLossR: losses > 0 ? sumLossR / losses : null,
    profitFactor: negR < 0 ? posR / Math.abs(negR) : null,
    totalR,
    totalPnl: pnlCount > 0 ? totalPnl : null,
  };
}
