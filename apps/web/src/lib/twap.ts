/**
 * TWAP execution planner. Splits a parent order into N equal child slices over
 * time and compares two ways to fill it against the live book:
 *   • Aggressive — take the whole size now, walking deep into the book.
 *   • TWAP — each slice hits a *refreshed* top-of-book (assuming the book
 *     refills between slices), so impact is that of one small slice.
 * The gap between the two is the modelled impact saving. Pure for unit testing;
 * reuses the slippage book-walk. Assumes full refill and no price drift over the
 * window — best case for impact, and it ignores the timing risk of waiting.
 */

import { walkBook, type FillResult, type Level, type Side } from './slippage';

export interface TwapInputs {
  levels: Level[];
  side: Side;
  totalBase: number;
  slices: number;
  intervalSec: number;
}

export interface TwapSlice {
  index: number;
  tOffsetSec: number;
  size: number;
  cumSize: number;
}

export interface TwapPlan {
  valid: boolean;
  slices: number;
  sliceSize: number;
  durationSec: number;
  schedule: TwapSlice[];
  aggressive: FillResult; // whole size now
  sliceFill: FillResult; // one slice vs a refreshed book
  twapAvgPrice: number | null; // blended TWAP fill (== sliceFill under full refill)
  twapFilledBase: number;
  twapExhausted: boolean;
  savingsPerUnit: number | null; // favourable price gained per base unit
  savingsQuote: number | null; // total saved, in quote
  savingsBps: number | null; // saving vs the aggressive average, in bps
  aggressiveBps: number | null; // block impact vs touch, in bps
  twapBps: number | null; // slice impact vs touch, in bps
}

export function planTwap({ levels, side, totalBase, slices, intervalSec }: TwapInputs): TwapPlan {
  const n = Math.max(1, Math.floor(slices || 1));
  const total = Number.isFinite(totalBase) && totalBase > 0 ? totalBase : 0;
  const sliceSize = total / n;
  const interval = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 0;

  const aggressive = walkBook(levels, side, total, 'base');
  const sliceFill = walkBook(levels, side, sliceSize, 'base');

  const schedule: TwapSlice[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += sliceSize;
    schedule.push({ index: i + 1, tOffsetSec: i * interval, size: sliceSize, cumSize: cum });
  }

  const twapAvgPrice = sliceFill.avgPrice;
  const twapFilledBase = sliceFill.filledBase * n;

  let savingsPerUnit: number | null = null;
  let savingsBps: number | null = null;
  if (aggressive.avgPrice != null && twapAvgPrice != null && aggressive.avgPrice > 0) {
    // Buying: a lower average is better; selling: a higher average is better.
    savingsPerUnit = side === 'buy' ? aggressive.avgPrice - twapAvgPrice : twapAvgPrice - aggressive.avgPrice;
    savingsBps = (savingsPerUnit / aggressive.avgPrice) * 10000;
  }
  const savingsQuote =
    savingsPerUnit != null ? savingsPerUnit * Math.min(aggressive.filledBase, twapFilledBase) : null;

  return {
    valid: total > 0 && levels.length > 0 && aggressive.avgPrice != null,
    slices: n,
    sliceSize,
    durationSec: (n - 1) * interval,
    schedule,
    aggressive,
    sliceFill,
    twapAvgPrice,
    twapFilledBase,
    twapExhausted: sliceFill.exhausted,
    savingsPerUnit,
    savingsQuote,
    savingsBps,
    aggressiveBps: aggressive.slippagePct != null ? aggressive.slippagePct * 100 : null,
    twapBps: sliceFill.slippagePct != null ? sliceFill.slippagePct * 100 : null,
  };
}
