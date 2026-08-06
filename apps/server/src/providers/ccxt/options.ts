import type { Exchange } from 'ccxt';
import type { DvolSnapshot, DvolSymbol } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import type { DataProvider } from '../types';
import { ProviderError } from '../types';
import { providerUnavailableReceipt, withProviderReceipt } from '../receipts';
import { safeErrorLabel } from './helpers';

/**
 * The slice of CcxtProvider the extracted ccxt/* readers need, beyond the
 * DataProvider surface the receipt helpers already take (receipt identity:
 * `withProviderReceipt(ctx, …)` must keep embedding the provider's own
 * name/capabilities, so functions receive the provider instance, never a bare
 * Exchange). CcxtProvider satisfies this structurally; later decomposition
 * steps extend it (exchange, exchangeId, compareExchanges) as their modules
 * land.
 *
 * Convention (decided in step 2a, copied by later steps): ctx exposes
 * `normalize(symbol)` and each module derives its own base/perp forms from
 * it — delegates pass the raw caller symbol, never a pre-normalized one.
 */
export interface CcxtReadContext extends DataProvider {
  /** Injected clock (CcxtProviderDeps.now) — extracted code never calls Date.now. */
  readonly now: () => number;
  /** BTC-USD → BTC/USD; already-unified symbols pass through. */
  normalize(symbol: string): string;
  /** The lazy, public Deribit client backing the options surface. */
  deribit(): Exchange;
}

/** The fields the options surface reads off a ccxt option-chain entry. */
export interface DeribitOptionQuote {
  openInterest?: number;
  markPrice?: number;
  underlyingPrice?: number;
  timestamp?: number;
  info?: { mark_iv?: number };
}

/** Base asset of any symbol form — BTC/USDT, BTC-USD or BTC all give BTC. */
export function baseAsset(ctx: CcxtReadContext, symbol: string): string {
  return ctx.normalize(symbol).split('/')[0].replace(/:.*$/, '');
}

async function dvolUnavailable(ctx: CcxtReadContext, symbol: DvolSymbol, note: string): Promise<DvolSnapshot> {
  const value: DvolSnapshot = {
    symbol, value: null, history: [], asOf: null, provenance: 'unavailable', source: 'ccxt:deribit', note,
  };
  return { ...value, receipt: providerUnavailableReceipt(ctx, {
    datasetFamily: 'options', source: 'ccxt:deribit', instrument: symbol, venue: 'deribit',
    coverage: 'Deribit DVOL level and history', units: { value: 'annualized-volatility-percent' }, note,
  }, ctx.now()) };
}

/**
 * The Deribit DVOL volatility index (30-day forward-looking implied vol).
 * ccxt exposes no unified method for it, so this uses the deribit client's
 * implicit get_volatility_index_data endpoint — guarded by a typeof check,
 * Unsupported capability is an honest unavailable result. Operational and
 * malformed upstream failures throw a sanitized ProviderError so status can
 * distinguish them from ordinary lack of support.
 */
export async function fetchDvol(ctx: CcxtReadContext, symbol: DvolSymbol): Promise<DvolSnapshot> {
  const ex = ctx.deribit() as Exchange & {
    publicGetGetVolatilityIndexData?: (params: Record<string, unknown>) => Promise<unknown>;
  };
  if (typeof ex.publicGetGetVolatilityIndexData !== 'function') {
    return dvolUnavailable(ctx, symbol, 'The installed ccxt build exposes no Deribit volatility-index endpoint — DVOL is unavailable.');
  }
  try {
    const end = ctx.now();
    const res = (await ex.publicGetGetVolatilityIndexData({
      currency: symbol,
      start_timestamp: end - 40 * 86_400_000,
      end_timestamp: end,
      resolution: '1D',
    })) as { result?: { data?: unknown } };
    // Rows are [timestamp_ms, open, high, low, close] — the daily index fixes.
    if (!Array.isArray(res?.result?.data)) {
      throw new ProviderError(
        `Deribit returned a malformed DVOL response for ${symbol}.`,
        502,
        symbol,
        'malformed-upstream',
      );
    }
    const rows = res.result.data as number[][];
    const history = rows
      .filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[4]) && r[4] > 0)
      .map((r) => ({ time: r[0], value: r[4] }));
    const last = history[history.length - 1];
    if (!last) {
      if (rows.length > 0) {
        throw new ProviderError(
          `Deribit returned malformed DVOL fixes for ${symbol}.`,
          502,
          symbol,
          'malformed-upstream',
        );
      }
      return dvolUnavailable(ctx, symbol, `Deribit returned no DVOL fixes for ${symbol} — nothing to show.`);
    }
    const omitted = rows.length - history.length;
    const value: DvolSnapshot = {
      symbol,
      value: last.value,
      history,
      asOf: last.time,
      provenance: 'live',
      source: 'ccxt:deribit',
      note: null,
    };
    return withProviderReceipt(ctx, value, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: symbol, venue: 'deribit',
      provenance: 'live', sourceAsOf: last.time, coverage: 'Deribit DVOL level and history',
      units: { value: 'annualized-volatility-percent' },
      limitations: omitted > 0
        ? [partialEvidenceLimitation(
            `DVOL read attempted ${rows.length} fix row(s); ${history.length} returned usable evidence and ${omitted} were malformed and omitted.`,
          )]
        : [],
    }, end);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`Deribit DVOL read failed — ${safeErrorLabel(err)}.`, 502, symbol);
  }
}
