import type { AccountFill, EquityPoint, Quote } from '@midas/shared';
import type { DataProvider } from './providers';

/**
 * Daily P&L recap — the account-side sections of the operator digest: equity
 * change from persisted snapshots, fill activity with round-trip realized
 * P&L, and the biggest movers among current position symbols. All read-only,
 * all computed from reads other features already make.
 *
 * Notional convention matches the trading caps: quote notional ≈ USD (exact
 * for USD-quoted pairs and linear perps), rendered with an honest "≈$".
 */

export interface EquityChange {
  startUsd: number;
  endUsd: number;
  startAt: number;
  endAt: number;
}

/**
 * Equity change over (sinceMs, nowMs] from the snapshot series (oldest →
 * newest): baseline is the last snapshot at/before the period start (or the
 * first one inside the period), the end is the latest snapshot. Null when the
 * series can't honestly speak for the period — no snapshots, or nothing new
 * since the baseline. Pure.
 */
export function equityChange(points: EquityPoint[], sinceMs: number, nowMs: number): EquityChange | null {
  let start: EquityPoint | null = null;
  let firstInPeriod: EquityPoint | null = null;
  let end: EquityPoint | null = null;
  for (const p of points) {
    if (p.at > nowMs) break;
    if (p.at <= sinceMs) start = p;
    else if (firstInPeriod == null) firstInPeriod = p;
    end = p;
  }
  const baseline = start ?? firstInPeriod;
  if (!baseline || !end || end.at <= baseline.at) return null;
  return { startUsd: baseline.totalUsd, endUsd: end.totalUsd, startAt: baseline.at, endAt: end.at };
}

export interface FillRecap {
  /** Fills executed within the period (timestamped ones only). */
  count: number;
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  /** Total fees paid, keyed by fee currency. */
  feesByCurrency: Record<string, number>;
  /**
   * Realized P&L (ex-fees) on quantity both opened and closed within the
   * period, FIFO-matched per symbol; null when nothing round-tripped.
   */
  roundTripPnlUsd: number | null;
  /** Fills the exchange reported without timestamps — excluded from the window. */
  untimed: number;
}

interface Lot {
  price: number;
  amount: number;
}

/** Consume `amount` from the FIFO lot queue; returns [matched, Σ matched×lotPrice]. */
function consume(lots: Lot[], amount: number): [number, number] {
  let matched = 0;
  let basis = 0;
  while (amount > 0 && lots.length > 0) {
    const lot = lots[0];
    const take = Math.min(lot.amount, amount);
    matched += take;
    basis += take * lot.price;
    amount -= take;
    lot.amount -= take;
    if (lot.amount <= 0) lots.shift();
  }
  return [matched, basis];
}

/**
 * Summarize the period's fills: activity totals, fees, and FIFO round-trip
 * realized P&L per symbol (a sell closes period buys long-side; a buy closes
 * period sells short-side — only quantity matched inside the period counts,
 * so positions opened before the window are honestly out of scope). Pure.
 */
export function fillRecap(fills: AccountFill[], sinceMs: number, nowMs: number): FillRecap | null {
  const untimed = fills.filter((f) => f.timestamp == null).length;
  const inWindow = fills
    .filter((f) => f.timestamp != null && f.timestamp > sinceMs && f.timestamp <= nowMs)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (inWindow.length === 0 && untimed === 0) return null;

  let buyNotionalUsd = 0;
  let sellNotionalUsd = 0;
  const feesByCurrency: Record<string, number> = {};
  const longs = new Map<string, Lot[]>();
  const shorts = new Map<string, Lot[]>();
  let pnl = 0;
  let matchedAny = false;

  for (const f of inWindow) {
    if (f.side === 'buy') buyNotionalUsd += f.cost;
    else sellNotionalUsd += f.cost;
    if (f.fee != null && f.feeCurrency) {
      feesByCurrency[f.feeCurrency] = (feesByCurrency[f.feeCurrency] ?? 0) + f.fee;
    }
    const opposite = f.side === 'buy' ? shorts : longs;
    const same = f.side === 'buy' ? longs : shorts;
    const queue = opposite.get(f.symbol) ?? [];
    const [matched, basis] = consume(queue, f.amount);
    opposite.set(f.symbol, queue);
    if (matched > 0) {
      matchedAny = true;
      // Closing shorts with a buy: pnl = shortBasis − buyCost; closing longs
      // with a sell: pnl = sellProceeds − longBasis. Same formula, signed:
      pnl += f.side === 'buy' ? basis - matched * f.price : matched * f.price - basis;
    }
    const leftover = f.amount - matched;
    if (leftover > 0) {
      const mine = same.get(f.symbol) ?? [];
      mine.push({ price: f.price, amount: leftover });
      same.set(f.symbol, mine);
    }
  }

  return {
    count: inWindow.length,
    buyNotionalUsd,
    sellNotionalUsd,
    feesByCurrency,
    roundTripPnlUsd: matchedAny ? pnl : null,
    untimed,
  };
}

export interface Mover {
  symbol: string;
  changePercent: number;
}

/** Biggest absolute 24h movers among the given quotes, largest first. Pure. */
export function topMovers(quotes: Quote[], limit = 3): Mover[] {
  return quotes
    .filter((q) => Number.isFinite(q.changePercent))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, limit)
    .map((q) => ({ symbol: q.symbol, changePercent: q.changePercent }));
}

export interface DigestRecap {
  equity: EquityChange | null;
  fills: FillRecap | null;
  movers: Mover[] | null;
}

const MOVER_SYMBOL_CAP = 8;

/**
 * Assemble the recap from live account reads. Each section degrades to null
 * independently (a failed read yields an omitted line, never a made-up one).
 */
export async function composeRecap(
  provider: DataProvider | null,
  equityPoints: (() => EquityPoint[]) | null,
  sinceMs: number,
  nowMs: number,
): Promise<DigestRecap> {
  const equity = equityPoints ? equityChange(equityPoints(), sinceMs, nowMs) : null;

  let fills: FillRecap | null = null;
  if (provider) {
    try {
      const res = await provider.getFills();
      if (res.provenance === 'live') fills = fillRecap(res.fills, sinceMs, nowMs);
    } catch {
      /* unreadable → omitted */
    }
  }

  let movers: Mover[] | null = null;
  if (provider) {
    try {
      const positions = await provider.getPositions();
      if (positions.provenance === 'live') {
        const symbols = [...new Set(positions.positions.map((p) => p.symbol))].slice(0, MOVER_SYMBOL_CAP);
        if (symbols.length > 0) {
          const settled = await Promise.allSettled(symbols.map((s) => provider.getQuote(s)));
          const quotes = settled
            .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
            .map((r) => r.value);
          const top = topMovers(quotes);
          if (top.length > 0) movers = top;
        }
      }
    } catch {
      /* unreadable → omitted */
    }
  }

  return { equity, fills, movers };
}

const usd = (n: number): string =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const signedUsd = (n: number): string => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const signedPct = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;

/** Render the recap sections as digest lines (empty array = nothing to say). Pure. */
export function recapLines(recap: DigestRecap): string[] {
  const lines: string[] = [];
  if (recap.equity) {
    const { startUsd, endUsd } = recap.equity;
    const delta = endUsd - startUsd;
    const pct = startUsd !== 0 ? (delta / Math.abs(startUsd)) * 100 : null;
    lines.push(
      `• Equity: ${usd(startUsd)} → ${usd(endUsd)} (${signedUsd(delta)}${pct != null ? `, ${signedPct(pct)}` : ''})`,
    );
  }
  if (recap.fills) {
    const f = recap.fills;
    const parts = [`• Fills: ${f.count} (bought ≈${usd(f.buyNotionalUsd)}, sold ≈${usd(f.sellNotionalUsd)})`];
    if (f.roundTripPnlUsd != null) parts.push(`round-trip P&L ≈${signedUsd(f.roundTripPnlUsd)} (ex-fees)`);
    const fees = Object.entries(f.feesByCurrency)
      .map(([ccy, amt]) => `${amt.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${ccy}`)
      .join(', ');
    if (fees) parts.push(`fees ${fees}`);
    lines.push(parts.join(' · '));
    if (f.untimed > 0) {
      lines.push(`• Note: ${f.untimed} fill${f.untimed === 1 ? '' : 's'} without timestamps excluded from the window.`);
    }
  }
  if (recap.movers && recap.movers.length > 0) {
    lines.push(
      `• Movers (your positions): ${recap.movers.map((m) => `${m.symbol} ${signedPct(m.changePercent)}`).join(' · ')}`,
    );
  }
  return lines;
}
