import type { DvolSnapshot, DvolSymbol, OptionsChain, OptionsChainEntry, TermStructure, TermStructurePoint } from '@midas/shared';
import { computeMaxPainStrike, computePutCallOiRatio } from '@midas/shared';
import { gaussian, round, seeded, uniform } from '../util';
import { MOCK_SOURCE, resolveEntry } from './fixtures';
import { buildQuote } from './quote';

/**
 * Deterministic synthetic options / DVOL / term-structure fixtures. Same rules
 * as the rest of the mock: stable within a short bucket, reproducible for a
 * given (symbol, bucket) pair, always labeled `provenance: 'synthetic'` — and
 * realistic in SHAPE (a contango term structure, an IV smile, max pain near
 * round strikes) so the panels exercise the same rendering paths as live
 * Deribit data. Nothing here is real market data.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Deribit-style instrument date code: 27SEP24. */
function dateCode(expiryMs: number): string {
  const d = new Date(expiryMs);
  return `${d.getUTCDate()}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
}

/** Next Friday 08:00 UTC (the Deribit expiry convention), `weeksOut` weeks later. */
function fridayExpiry(now: number, weeksOut: number): number {
  const d = new Date(now);
  let delta = (5 - d.getUTCDay() + 7) % 7;
  if (delta === 0 && d.getUTCHours() >= 8) delta = 7; // already past this week's settlement
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta + weeksOut * 7, 8);
}

/** Strike step for an underlying of this price: round, Deribit-like increments. */
function strikeStep(mid: number): number {
  if (mid >= 20_000) return 1_000;
  if (mid >= 2_000) return 100;
  if (mid >= 200) return 10;
  if (mid >= 20) return 1;
  return 0.5;
}

/** The DVOL base level per underlier — BTC vols sit lower than ETH's. */
const DVOL_BASE: Record<DvolSymbol, number> = { BTC: 52, ETH: 63 };

/**
 * Synthetic DVOL snapshot: the index level wiggles hour-to-hour around a
 * per-underlier base, and the 30-day history is a deterministic daily walk, so
 * the sparkline is stable for a given hour and agrees with the current value.
 */
export async function mockDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
  const now = Date.now();
  const day = Math.floor(now / 86_400_000);
  const base = DVOL_BASE[symbol];
  const history = Array.from({ length: 30 }, (_, i) => {
    const t = (day - (29 - i)) * 86_400_000;
    const rng = seeded(symbol, day - (29 - i), 'dvolhist');
    return { time: t, value: round(base + Math.sin((day - (29 - i)) / 4) * 6 + gaussian(rng) * 2.5, 2) };
  });
  // The current level continues the walk intra-day (hour-stable).
  const hourRng = seeded(symbol, Math.floor(now / 3_600_000), 'dvol');
  const value = round(history[history.length - 1].value + gaussian(hourRng) * 0.8, 2);
  return {
    symbol,
    value,
    history,
    asOf: now,
    provenance: 'synthetic',
    source: MOCK_SOURCE,
    note: `Synthetic DVOL for offline/demo use — not the real Deribit ${symbol} volatility index.`,
  };
}

/**
 * Synthetic dated-futures term structure: five Deribit-style expiries (the
 * next four Fridays plus a quarterly) in gentle contango — annualized basis
 * rises with time to expiry (~3% front → ~8–9% at the back) with a small
 * deterministic jitter, so the panel's contango coloring and perp comparison
 * render realistically.
 */
export async function mockTermStructure(symbol: string): Promise<TermStructure> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const base = entry.symbol.split('/')[0].replace(/:.*$/, '');
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);

  const weeks = [0, 1, 2, 4, 13];
  const points: TermStructurePoint[] = weeks.map((w) => {
    const expiry = fridayExpiry(now, w);
    const daysToExpiry = (expiry - now) / 86_400_000;
    const rng = seeded(base, w, hour, 'term');
    const basisPct = round(3 + 6 * Math.sqrt(daysToExpiry / 365) + uniform(rng, -0.4, 0.4), 2);
    const price = round(mid * (1 + (basisPct / 100) * (daysToExpiry / 365)), 2);
    return { expiry, futureSymbol: `${base}-${dateCode(expiry)}`, price, annualizedBasisPct: basisPct, daysToExpiry: round(daysToExpiry, 1) };
  });

  // The perp trades a hair off the index — the panel compares it to the curve.
  const perpRng = seeded(base, hour, 'termperp');
  const perpPrice = round(mid * (1 + uniform(perpRng, -0.0004, 0.0008)), 2);

  return {
    underlying: base,
    referencePrice: mid,
    perpPrice,
    points,
    asOf: now,
    provenance: 'synthetic',
    source: MOCK_SOURCE,
    note: 'Synthetic futures term structure for offline/demo use — not real dated-futures prices.',
  };
}

/**
 * Synthetic options chain: 21 strikes around the money with a call/put OI
 * split by moneyness (puts heavier below, calls heavier above), an IV smile
 * that lifts in the wings, crude intrinsic-plus-time-value marks, and the
 * derived max pain / put-call ratio from the shared helpers — so a max pain
 * near a round strike emerges from the OI shape rather than being hard-coded.
 */
export async function mockOptionsChain(symbol: string, expiry: number | 'nearest' = 'nearest'): Promise<OptionsChain> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const base = entry.symbol.split('/')[0].replace(/:.*$/, '');
  const now = Date.now();
  const target = expiry === 'nearest' ? fridayExpiry(now, 0) : expiry;
  const daysToExpiry = Math.max((target - now) / 86_400_000, 0.5);
  const day = Math.floor(now / 86_400_000);

  const step = strikeStep(mid);
  const atm = Math.round(mid / step) * step;
  const ivBase = base === 'BTC' ? 52 : base === 'ETH' ? 63 : 70;

  const entries: OptionsChainEntry[] = [];
  for (let i = -10; i <= 10; i++) {
    const k = atm + i * step;
    if (k <= 0) continue;
    const moneyness = (k - mid) / mid;
    const rng = seeded(base, k, day, 'optchain');
    // OI humps near the money and near round strikes, with puts heavier below
    // and calls heavier above (the classic hedging/overwrite shape).
    const hump = Math.exp(-Math.pow(i / 6, 2));
    const roundBoost = k % (step * 5) === 0 ? 1.5 : 1;
    const callOi = Math.floor(uniform(rng, 300, 900) * hump * roundBoost * (1 + Math.max(moneyness, 0) * 3));
    const putOi = Math.floor(uniform(rng, 300, 900) * hump * roundBoost * (1 + Math.max(-moneyness, 0) * 3));
    const iv = round(ivBase + moneyness * moneyness * 220 + gaussian(rng) * 1.5, 1);
    // Crude marks: intrinsic + a time-value fraction that decays off the money.
    const t = daysToExpiry / 365;
    const timeValue = mid * (iv / 100) * Math.sqrt(t) * 0.4 * hump;
    const callMark = round(Math.max(mid - k, 0) + timeValue, 2);
    const putMark = round(Math.max(k - mid, 0) + timeValue, 2);
    entries.push({ strike: k, expiry: target, callOi, putOi, callMark, putMark, iv });
  }

  const pcr = computePutCallOiRatio(entries);
  return {
    underlying: base,
    expiry: target,
    underlyingPrice: mid,
    entries,
    maxPainStrike: computeMaxPainStrike(entries),
    putCallOiRatio: pcr == null ? null : round(pcr, 3),
    asOf: now,
    provenance: 'synthetic',
    source: MOCK_SOURCE,
    note: 'Synthetic options chain for offline/demo use — not real Deribit open interest or marks.',
  };
}
