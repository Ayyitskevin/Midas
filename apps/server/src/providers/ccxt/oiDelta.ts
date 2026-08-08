import type { OiDelta, OiDeltaPoint, OiDeltaWindow } from '@midas/shared';
import { OI_DELTA_WINDOW_MS, partialEvidenceLimitation, summarizeOiDelta } from '@midas/shared';
import { ProviderError } from '../types';
import { providerReceipt, providerUnavailableReceipt, withProviderDerivedReceipt } from '../receipts';
import { safeErrorLabel, timeframeSeconds, toPerpSymbol } from './helpers';
import { positiveFiniteOrNull, sourceTimestampOrNull } from './coerce';
import type { CcxtReadContext } from './context';

// Re-exported so this module's own import sites keep working while the rest of
// the decomposition lands; `ccxt/context.ts` is the one definition.
export type { CcxtReadContext };

/**
 * OI-delta positioning for a perp over a lookback window: the venue's OI
 * history (fetchOpenInterestHistory, where the venue publishes one — Binance,
 * Bybit, OKX, Gate do; Deribit and Kraken Futures do not) paired with OHLCV
 * closes over the same window, then reduced to the ΔOI × Δprice quadrant by
 * the shared summarizeOiDelta helper.
 *
 * Basis: ccxt's OpenInterest structure carries openInterestAmount
 * (contracts/base units) alongside openInterestValue (notional). The delta
 * prefers the contract-denominated scalar — price-invariant positioning — and
 * falls back to notional with the basis labeled on `oiBasis` plus a receipt
 * limitation, because notional OI drifts with price and would read a
 * flat-position rally as a buildup.
 *
 * Alignment: each OI observation is paired with the close of the price bar
 * whose floor-aligned bucket it falls into — bucket width = the OI timeframe
 * (5m/15m/1h/4h per window). Some venues timestamp OI at the PERIOD END while
 * OHLCV bars are stamped at the period start, so an observation one bucket
 * ahead of its bar is paired back one bucket; anything further off is left
 * price-null. Classification requires prices at the exact first and last OI
 * endpoints; inner priced points never shorten the requested comparison.
 *
 * A venue without an OI-history read, an empty history, or a failed read is
 * an honest 'unavailable' — a delta is NEVER synthesized from two
 * point-in-time snapshots and presented as history.
 */
export async function fetchOiDelta(ctx: CcxtReadContext, symbol: string, window: OiDeltaWindow): Promise<OiDelta> {
  const perp = toPerpSymbol(ctx.normalize(symbol));
  const source = `ccxt:${ctx.exchange.id ?? 'unknown'}`;
  const now = ctx.now();
  const unavailable = (note: string): OiDelta => {
    const value: OiDelta = {
      symbol: perp,
      window,
      oiBasis: null,
      oiNow: null,
      oiThen: null,
      oiChangePct: null,
      priceChangePct: null,
      classification: null,
      points: [],
      asOf: null,
      provenance: 'unavailable',
      source,
      note,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'open-interest-delta', instrument: perp, venue: ctx.exchangeId,
      coverage: `${window} OI/price alignment`,
      units: { openInterestAmount: 'base-asset', openInterestValue: 'quote-asset', price: 'quote-asset', change: 'percent' },
      note,
    }, ctx.now()) };
  };
  if (!ctx.exchange.has['fetchOpenInterestHistory']) {
    return unavailable(
      `${source} publishes no open-interest history (fetchOpenInterestHistory unsupported) — an OI delta needs real history, not two snapshots.`,
    );
  }
  // OI granularity per window: fine enough for a sparkline, coarse enough to
  // stay within the venues' published OI-history timeframes.
  const oiTimeframe = ({ '1h': '5m', '4h': '15m', '24h': '1h', '7d': '4h' } as Record<OiDeltaWindow, string>)[window];
  const bucketMs = timeframeSeconds(oiTimeframe) * 1000;
  const since = now - OI_DELTA_WINDOW_MS[window];
  let rows: Array<{ timestamp?: number; openInterestAmount?: number; openInterestValue?: number }>;
  try {
    const response = await ctx.exchange.fetchOpenInterestHistory(perp, oiTimeframe, since, 500);
    if (!Array.isArray(response)) {
      throw new ProviderError(
        `${source} returned a malformed open-interest history response.`,
        502,
        perp,
        'malformed-upstream',
      );
    }
    rows = response as unknown as Array<{
      timestamp?: number;
      openInterestAmount?: number;
      openInterestValue?: number;
    }>;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`OI-history read failed — ${safeErrorLabel(err)}.`, 502, perp);
  }
  // ccxt's OpenInterest structure carries openInterestAmount (contracts/base
  // units — Binance, Bybit, Gate report it; OKX reports amount OR value per
  // its oiCcy mode) alongside openInterestValue (notional). Either scalar is
  // usable evidence; summarizeOiDelta prefers the price-invariant one.
  const oiRows = rows.filter(
    (r) =>
      sourceTimestampOrNull(r?.timestamp) !== null &&
      (positiveFiniteOrNull(r?.openInterestAmount) !== null || positiveFiniteOrNull(r?.openInterestValue) !== null),
  );
  const omittedOiRows = rows.length - oiRows.length;
  if (rows.length > 0 && oiRows.length === 0) {
    throw new ProviderError(
      `${source} returned a malformed open-interest history response.`,
      502,
      perp,
      'malformed-upstream',
    );
  }
  if (oiRows.length === 0) {
    return unavailable(`${source} returned no open-interest history for ${perp} — nothing to delta.`);
  }
  oiRows.sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  const outOfWindow = oiRows.filter((row) => {
    const timestamp = row.timestamp as number;
    return timestamp < since - bucketMs || timestamp > now;
  });
  if (outOfWindow.length > 0) {
    throw new ProviderError(
      `${source} returned out-of-window open-interest history observations.`,
      502,
      perp,
      'malformed-upstream',
    );
  }
  const earliestOi = oiRows[0].timestamp as number;
  const latestOi = oiRows[oiRows.length - 1].timestamp as number;
  if (earliestOi > since + bucketMs || latestOi < now - bucketMs) {
    return unavailable(
      `${source} did not cover the requested ${window} window within the ${oiTimeframe} endpoint tolerance — no delta was classified.`,
    );
  }
  const actualCoverageMs = latestOi - earliestOi;

  // Price leg: OHLCV closes over the same window, perp first, the spot pair
  // as fallback (a venue may not candle its perp on the same symbol form).
  // A failed price leg degrades the price points to null — the OI change and
  // history stay live, the price change honestly null.
  let candles: Array<[number, number, number, number, number, number]> = [];
  let priceReadErrors = 0;
  let attemptedPriceRows = 0;
  let omittedPriceRows = 0;
  for (const cand of [perp, ctx.normalize(symbol)]) {
    try {
      const response = await ctx.exchange.fetchOHLCV(cand, oiTimeframe, since, 500);
      if (!Array.isArray(response)) throw new Error('malformed OHLCV response');
      const got = response as unknown as Array<
        [number, number, number, number, number, number]
      >;
      attemptedPriceRows += got.length;
      const usable = got.filter(
        (row) => sourceTimestampOrNull(row?.[0]) !== null && positiveFiniteOrNull(row?.[4]) !== null,
      );
      omittedPriceRows += got.length - usable.length;
      if (usable.length > 0) {
        candles = usable;
        break;
      }
    } catch {
      priceReadErrors += 1;
      // try the next symbol form
    }
  }
  const closeByBucket = new Map<number, number>();
  for (const c of candles) {
    if (Number.isFinite(c[0]) && Number.isFinite(c[4]) && c[4] > 0) {
      closeByBucket.set(Math.floor(c[0] / bucketMs) * bucketMs, c[4]);
    }
  }

  const points: OiDeltaPoint[] = oiRows.map((r) => {
    const ts = r.timestamp as number;
    const b = Math.floor(ts / bucketMs) * bucketMs;
    // Period-end vs period-start convention: fall back one bucket (see the
    // method doc for the alignment tolerance).
    const price = closeByBucket.get(b) ?? closeByBucket.get(b - bucketMs) ?? null;
    return {
      timestamp: ts,
      openInterestAmount: positiveFiniteOrNull(r.openInterestAmount),
      openInterestValue: positiveFiniteOrNull(r.openInterestValue),
      price,
    };
  });
  points.sort((a, b) => a.timestamp - b.timestamp);

  const summary = summarizeOiDelta(points);
  const value: OiDelta = {
    symbol: perp,
    window,
    ...summary,
    points,
    provenance: 'live',
    source,
    note: null,
  };
  const oiSourceAsOf = points.at(-1)?.timestamp ?? null;
  const priceSourceAsOf = candles
    .map((candle) => sourceTimestampOrNull(candle[0]))
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((a, b) => b - a)[0] ?? null;
  const oiInput = providerReceipt(ctx, {
    datasetFamily: 'open-interest-history', instrument: perp, venue: ctx.exchangeId,
    provenance: 'live', sourceAsOf: oiSourceAsOf,
    expectedCadenceMs: bucketMs,
    maxAgeMs: bucketMs * 2,
    coverage: `${window} requested; ${actualCoverageMs}ms actual OI endpoint coverage`,
    units: { openInterestAmount: 'base-asset', openInterestValue: 'quote-asset' },
    limitations: omittedOiRows > 0
      ? [partialEvidenceLimitation(
          `Open-interest history attempted ${rows.length} row(s); ${oiRows.length} returned usable evidence and ${omittedOiRows} were malformed and omitted.`,
        )]
      : [],
  }, now);
  const priceInput = providerReceipt(ctx, {
    datasetFamily: 'history', instrument: perp, venue: ctx.exchangeId,
    provenance: 'live', sourceAsOf: priceSourceAsOf, coverage: `${window} aligned price history`,
    expectedCadenceMs: bucketMs,
    maxAgeMs: bucketMs * 2,
    units: { price: 'quote-asset' },
    limitations: [
      ...(candles.length === 0
        ? [partialEvidenceLimitation('No usable OHLCV price history was returned for OI alignment.')]
        : []),
      ...(priceReadErrors > 0
        ? [partialEvidenceLimitation('One or more OHLCV upstream reads failed during price alignment.')]
        : []),
      ...(omittedPriceRows > 0
        ? [partialEvidenceLimitation(
            `Price-history alignment attempted ${attemptedPriceRows} row(s); ${attemptedPriceRows - omittedPriceRows} returned usable evidence and ${omittedPriceRows} were malformed and omitted.`,
          )]
        : []),
    ],
  }, now);
  return withProviderDerivedReceipt(ctx, value, {
    datasetFamily: 'open-interest-delta', instrument: perp, venue: ctx.exchangeId,
    provenance: 'live', inputReceipts: [oiInput, priceInput],
    expectedCadenceMs: bucketMs,
    maxAgeMs: bucketMs * 2,
    coverage: `${window} requested; ${actualCoverageMs}ms actual aligned endpoint coverage`,
    units: { openInterestAmount: 'base-asset', openInterestValue: 'quote-asset', price: 'quote-asset', change: 'percent' },
    limitations: summary.oiBasis === 'notional'
      ? [partialEvidenceLimitation(
          'OI delta computed on notional (quote-denominated) open interest — the venue did not report contract/base-unit OI history; notional OI drifts with price, so the quadrant can read price drift as positioning.',
        )]
      : [],
    methodology: {
      id: 'midas.oi-delta', version: '1.1.0',
      formula: '(now/then - 1) * 100 over contract-denominated OI when the venue reports it (notional fallback, labeled on oiBasis); quadrant(sign(ΔOI), sign(Δprice))',
    },
  }, now);
}
