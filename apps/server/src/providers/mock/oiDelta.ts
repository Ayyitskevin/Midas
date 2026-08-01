import type { OiDelta, OiDeltaPoint, OiDeltaWindow } from '@midas/shared';
import { OI_DELTA_WINDOW_MS, summarizeOiDelta } from '@midas/shared';
import { gaussian, round, seeded, uniform } from '../util';
import { MOCK_SOURCE, resolveEntry } from './fixtures';
import { buildQuote } from './quote';

/**
 * Deterministic synthetic OI history for the OI-delta positioning board. Same
 * rules as the rest of the mock: reproducible for a (symbol, window, day)
 * triple, always labeled `provenance: 'synthetic'` — and COHERENT with the
 * mock's price walk, so the ΔOI × Δprice quadrants look real: the last price
 * point is the current quote mid, and the OI walk is correlated with the price
 * walk by a per-symbol regime (positive regimes render long buildup / long
 * unwind, negative regimes short buildup / short covering — all four quadrants
 * appear across the roster). Nothing here is real open-interest history.
 */

const POINTS = 48;

export async function mockOiDelta(symbol: string, window: OiDeltaWindow): Promise<OiDelta> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const perp = entry.symbol.includes(':') ? entry.symbol : `${entry.symbol}:${entry.currency}`;
  const now = Date.now();
  const day = Math.floor(now / 86_400_000);
  const bucketMs = OI_DELTA_WINDOW_MS[window] / POINTS;

  // Price walk: seeded log-returns across the window, normalized so the LAST
  // point equals the current quote mid — the delta is coherent with the price
  // the rest of the terminal shows. Total window vol is seeded per symbol.
  const vol = uniform(seeded(entry.symbol, window, day, 'oidvol'), 0.02, 0.08);
  const walkRng = seeded(entry.symbol, window, day, 'oidwalk');
  const rets = Array.from({ length: POINTS }, () => (gaussian(walkRng) * vol) / Math.sqrt(POINTS));
  const cum: number[] = [0];
  for (let i = 1; i < POINTS; i++) cum.push(cum[i - 1] + rets[i]);
  const prices = cum.map((c) => mid * Math.exp(c - cum[POINTS - 1]));

  // OI walk: correlated with the price returns by a per-symbol regime
  // coefficient, plus its own noise — so OI and price genuinely co-move (or
  // counter-move) and the classification is a real quadrant of the series, not
  // a label pasted on afterwards.
  const regime = seeded(entry.symbol, day, 'oidregime');
  const corr = uniform(regime, -1, 1);
  const amp = uniform(regime, 0.5, 2.5); // OI % response per 1% of price
  const noiseRng = seeded(entry.symbol, window, day, 'oidnoise');
  const oiBase = Math.floor(uniform(seeded(entry.symbol, day, 'oidbase'), 1_000, 250_000) * (mid > 1000 ? 1 : 1000)) * mid;
  const oiCum: number[] = [0];
  for (let i = 1; i < POINTS; i++) {
    oiCum.push(oiCum[i - 1] + corr * amp * rets[i] + gaussian(noiseRng) * 0.004);
  }

  const points: OiDeltaPoint[] = prices.map((price, i) => ({
    timestamp: now - (POINTS - 1 - i) * bucketMs,
    openInterestValue: Math.round(oiBase * Math.exp(oiCum[i])),
    price: round(price, 6),
  }));

  return {
    symbol: perp,
    window,
    ...summarizeOiDelta(points),
    points,
    provenance: 'synthetic',
    source: MOCK_SOURCE,
    note: 'Synthetic OI history for offline/demo use — not real open-interest history.',
  };
}
