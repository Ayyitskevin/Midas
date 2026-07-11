import type { MarketState, Quote } from '@midas/shared';
import type { RosterEntry } from './fixtures';
import { clamp, gaussian, round, seeded, uniform, usMarketState } from '../util';

export function buildQuote(entry: RosterEntry): Quote {
  const now = Date.now();
  const dayBucket = Math.floor(now / 86_400_000);
  const minuteBucket = Math.floor(now / 60_000);

  // Day-stable components (previous close, 52wk band, volume baseline).
  const dayRng = seeded(entry.symbol, dayBucket, 'day');
  const previousClose = round(entry.base * (1 + gaussian(dayRng) * 0.01));
  const fiftyTwoWeekHigh = round(entry.base * uniform(dayRng, 1.08, 1.4));
  const fiftyTwoWeekLow = round(entry.base * uniform(dayRng, 0.6, 0.92));
  const baseVolume = Math.floor(uniform(dayRng, 0.5, 1.5) * 30_000_000);
  const shares = Math.floor(uniform(dayRng, 0.4, 8) * 1_000_000_000);
  const open = round(previousClose * (1 + gaussian(dayRng) * 0.004));

  // Minute-stable component (the live wiggle).
  const minRng = seeded(entry.symbol, minuteBucket, 'min');
  const changePercent = clamp(gaussian(minRng) * 1.4, -8, 8);
  const price = round(previousClose * (1 + changePercent / 100));
  const change = round(price - previousClose);

  const dayHigh = round(Math.max(open, price) * (1 + Math.abs(gaussian(dayRng)) * 0.006));
  const dayLow = round(Math.min(open, price) * (1 - Math.abs(gaussian(dayRng)) * 0.006));

  const state: MarketState = entry.type === 'CRYPTOCURRENCY' ? 'REGULAR' : usMarketState(now);

  return {
    symbol: entry.symbol,
    name: entry.name,
    currency: entry.currency,
    exchange: entry.exchange,
    marketState: state,
    price,
    previousClose,
    open,
    dayHigh,
    dayLow,
    change,
    changePercent: round(previousClose === 0 ? 0 : (change / previousClose) * 100),
    volume: Math.floor(baseVolume * uniform(minRng, 0.6, 1.1)),
    marketCap: entry.type === 'INDEX' ? null : Math.floor(price * shares),
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    asOf: now,
  };
}
