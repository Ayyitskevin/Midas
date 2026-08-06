import type { Exchange } from 'ccxt';
import type { AccountFills, AccountPositions, Balances, OpenOrders, PlacedOrder } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import { sourceTimestampOrNull } from './coerce';
import type { CcxtReadContext } from './context';

// Re-exported under the old name so this module's own import sites keep
// working; the base context lives in `ccxt/context.ts`.
export type { CcxtAccountContext as CcxtReadContext };
import { ProviderError } from '../types';
import { providerReceipt, providerUnavailableReceipt, withProviderDerivedReceipt } from '../receipts';
import { STABLES, ccxtKeysConfigured, mapCcxtBalanceWithDiagnostics, sumValueUsd, unpricedCaveat } from '../balances';
import {
  mapMyTradesWithDiagnostics,
  mapOpenOrdersWithDiagnostics,
  mapPositionsWithDiagnostics,
  mergeVenueRows,
  sumUnrealizedPnl,
} from '../accountReads';
import { mapPlacedOrder } from '../../trading';
import { safeErrorLabel, tickerPrice } from './helpers';

/**
 * The account slice: the read context plus the per-user-keying flag, the
 * optional second venue, and the sanitized error describer. Declared here
 * rather than in context.ts because only the account readers need these three —
 * a market-data module has no business reaching `secondary` or `userKeyed`.
 */
export interface CcxtAccountContext extends CcxtReadContext {
  /** True when constructed from explicit per-user creds (vs operator env). */
  readonly userKeyed: boolean;
  /** Optional SECOND keyed venue for the multi-venue account view (operator env only; read-only). */
  readonly secondary: { ex: Exchange; id: string } | null;
  /** Sanitized failure description — never interpolates the raw ccxt error (signed URLs). */
  describe(err: unknown, symbol?: string): string;
}

export interface MappingSummary {
  rows: unknown[];
  inputValid: boolean;
  attempted: number;
  omitted: number;
}

export function assertUsableAccountMapping(mapping: MappingSummary, label: string): void {
  if (!mapping.inputValid || (mapping.attempted > 0 && mapping.rows.length === 0 && mapping.omitted > 0)) {
    throw new ProviderError(`Malformed ${label} payload from the configured exchange.`, 502, undefined, 'malformed-upstream');
  }
}

export function accountOmissionCaveat(mapping: MappingSummary | null, label: string): string | null {
  if (!mapping || mapping.omitted === 0) return null;
  return partialEvidenceLimitation(
    `${mapping.omitted} of ${mapping.attempted} ${label} row(s) were malformed and omitted; aggregates are partial.`,
  );
}

/** Whether THIS instance can make keyed account reads (creds or operator env). */
export function hasAccountKeys(ctx: CcxtAccountContext): boolean {
  return ctx.userKeyed || ccxtKeysConfigured();
}

/**
 * Run the same account read against the second venue. A secondary failure
 * never breaks the primary result — it comes back as an honest note.
 */
export async function fromSecondary<Row>(
  ctx: CcxtAccountContext,
  read: (ex: Exchange) => Promise<Row[]>,
): Promise<{ rows: Row[]; note: string | null } | null> {
  if (!ctx.secondary) return null;
  try {
    return { rows: await read(ctx.secondary.ex), note: null };
  } catch (err) {
    return {
      rows: [],
      note: `Second venue (${ctx.secondary.id}) unreadable — ${safeErrorLabel(err)}.`,
    };
  }
}

/** Best-effort USD prices for a set of assets (stables = $1; others via ASSET/USDT tickers). */
async function priceAssetsUsd(ctx: CcxtAccountContext, assets: string[], exchange: Exchange = ctx.exchange): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const need: string[] = [];
  for (const a of assets) {
    const up = a.toUpperCase();
    if (STABLES.has(up)) map.set(up, 1);
    else need.push(up);
  }
  if (need.length === 0) return map;
  try {
    const tickers = await exchange.fetchTickers(need.map((a) => `${a}/USDT`));
    for (const a of need) {
      const px = tickerPrice(tickers[`${a}/USDT`] ?? {});
      if (px != null) map.set(a, px);
    }
  } catch {
    // The batched fetchTickers rejects the WHOLE request when any one symbol
    // is invalid (a delisted/dust asset with no /USDT market), which would
    // otherwise leave EVERY balance unpriced. Fall back to per-symbol reads
    // so one bad asset only unprices itself.
    await Promise.all(
      need.map(async (a) => {
        try {
          const px = tickerPrice(await exchange.fetchTicker(`${a}/USDT`));
          if (px != null) map.set(a, px);
        } catch {
          // leave this one asset unpriced (valueUsd: null)
        }
      }),
    );
  }
  return map;
}

export async function fetchBalances(ctx: CcxtAccountContext): Promise<Balances> {
  if (!hasAccountKeys(ctx)) {
    const value: Balances = {
      source: ctx.name,
      provenance: 'unavailable',
      note:
        'Read-only balances need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
        '(use read-only keys — Midas never places orders and never holds your funds).',
      totalValueUsd: null,
      balances: [],
      asOf: ctx.now(),
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'balances',
      venue: ctx.exchangeId,
      units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
      note: value.note ?? 'Read-only balances are not configured.',
    }, value.asOf) };
  }
  try {
    // READ-ONLY account read. Midas is non-custodial: this calls only
    // fetchBalance — never createOrder or any write/withdraw method.
    let primarySourceAsOf: number | null = null;
    let secondarySourceAsOf: number | null = null;
    let primaryMapping: ReturnType<typeof mapCcxtBalanceWithDiagnostics> | null = null;
    let secondaryMapping: ReturnType<typeof mapCcxtBalanceWithDiagnostics> | null = null;
    const readBalances = async (ex: Exchange): Promise<ReturnType<typeof mapCcxtBalanceWithDiagnostics>['rows']> => {
      const raw = await ex.fetchBalance();
      if (ex === ctx.exchange) {
        primarySourceAsOf = sourceTimestampOrNull((raw as { timestamp?: unknown }).timestamp);
      } else {
        secondarySourceAsOf = sourceTimestampOrNull((raw as { timestamp?: unknown }).timestamp);
      }
      const totals = (raw as { total?: Record<string, unknown> }).total ?? {};
      const assets = Object.keys(totals).filter((a) => {
        const n = Number((totals as Record<string, unknown>)[a]);
        return Number.isFinite(n) && n > 0;
      });
      const prices = await priceAssetsUsd(ctx, assets, ex);
      const mapping = mapCcxtBalanceWithDiagnostics(raw, (asset) => prices.get(asset.toUpperCase()) ?? null);
      if (ex === ctx.exchange) primaryMapping = mapping;
      else secondaryMapping = mapping;
      assertUsableAccountMapping(mapping, 'balance');
      return mapping.rows;
    };
    let balances = await readBalances(ctx.exchange);
    const second = await fromSecondary(ctx, readBalances);
    if (second) {
      balances = mergeVenueRows(balances, ctx.exchangeId, second.rows, ctx.secondary!.id, (b) => b.valueUsd);
    }
    const sourceAsOf = second == null
      ? primarySourceAsOf
      : primarySourceAsOf !== null && secondarySourceAsOf !== null
        ? Math.min(primarySourceAsOf, secondarySourceAsOf)
        : null;
    const value: Balances = {
      source: ctx.name,
      provenance: 'live',
      // Honest total: assets with no /USDT market are excluded from the sum,
      // so when any exist the note must say the total is a floor.
      note: [
        second?.note,
        accountOmissionCaveat(primaryMapping, 'held balance'),
        accountOmissionCaveat(secondaryMapping, 'held balance'),
        unpricedCaveat(balances),
      ].filter(Boolean).join(' ') || null,
      totalValueUsd: sumValueUsd(balances),
      balances,
      asOf: ctx.now(),
    };
    const rawBalanceInput = providerReceipt(ctx, {
      datasetFamily: 'balances', venue: ctx.exchangeId, provenance: 'live', sourceAsOf,
      coverage: 'raw exchange asset quantities',
      units: { free: 'asset-units', used: 'asset-units', total: 'asset-units' },
    }, value.asOf);
    const pricingInput = providerReceipt(ctx, {
      datasetFamily: 'quote', venue: ctx.exchangeId, provenance: 'live', sourceAsOf: null,
      coverage: 'USDT ticker prices and explicit USD-stablecoin parity assumptions',
      units: { price: 'USD-per-asset' },
      limitations: ['Individual valuation-ticker source timestamps are not retained by this aggregate.'],
    }, value.asOf);
    return withProviderDerivedReceipt(ctx, value, {
      datasetFamily: 'balances', venue: ctx.exchangeId, provenance: 'live',
      inputReceipts: [rawBalanceInput, pricingInput], sourceAsOf: null,
      units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
      methodology: {
        id: 'midas.balance-usd-valuation', version: '1.0.0',
        formula: 'valueUsd = total * USD price; totalValueUsd = sum(known valueUsd)',
      },
      note: value.note,
    }, value.asOf);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Balance read failed — ${safeErrorLabel(err)}. Check that the API key is valid and has read access (read-only is sufficient).`,
      502,
    );
  }
}

export async function fetchOpenOrders(ctx: CcxtAccountContext): Promise<OpenOrders> {
  const asOf = ctx.now();
  if (!hasAccountKeys(ctx)) {
    const value: OpenOrders = {
      source: ctx.name,
      provenance: 'unavailable',
      note:
        'Read-only open orders need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
        '(use read-only keys — Midas never places or cancels orders).',
      orders: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-orders', venue: ctx.exchangeId,
      units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
      note: value.note ?? 'Read-only open orders are not configured.',
    }, asOf) };
  }
  if (!ctx.exchange.has['fetchOpenOrders']) {
    const value: OpenOrders = {
      source: ctx.name,
      provenance: 'unavailable',
      note: `${ctx.name} does not expose a fetchOpenOrders endpoint.`,
      orders: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-orders', venue: ctx.exchangeId,
      units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
      note: value.note ?? 'Open-orders reads are unsupported.',
    }, asOf) };
  }
  try {
    // READ-ONLY: fetchOpenOrders only — never createOrder/cancelOrder/editOrder.
    const raw = await ctx.exchange.fetchOpenOrders();
    const primaryMapping = mapOpenOrdersWithDiagnostics(raw);
    assertUsableAccountMapping(primaryMapping, 'open-orders');
    let orders = primaryMapping.rows;
    let secondaryMapping: ReturnType<typeof mapOpenOrdersWithDiagnostics> | null = null;
    const second = await fromSecondary(ctx, async (ex) => {
      if (!ex.has['fetchOpenOrders']) return [];
      secondaryMapping = mapOpenOrdersWithDiagnostics(await ex.fetchOpenOrders());
      assertUsableAccountMapping(secondaryMapping, 'open-orders');
      return secondaryMapping.rows;
    });
    if (second) {
      orders = mergeVenueRows(orders, ctx.exchangeId, second.rows, ctx.secondary!.id, (o) => o.timestamp);
    }
    const value: OpenOrders = {
      source: ctx.name,
      provenance: 'live',
      note: [
        second?.note,
        accountOmissionCaveat(primaryMapping, 'open-order'),
        accountOmissionCaveat(secondaryMapping, 'open-order'),
      ].filter(Boolean).join(' ') || null,
      orders,
      asOf,
    };
    const rawInput = providerReceipt(ctx, {
      datasetFamily: 'account-orders', venue: ctx.exchangeId, provenance: 'live', sourceAsOf: null,
      coverage: 'raw configured-exchange open-order rows',
      units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
      note: value.note,
    }, asOf);
    return withProviderDerivedReceipt(ctx, value, {
      datasetFamily: 'account-orders', venue: ctx.exchangeId, provenance: 'live', sourceAsOf: null,
      inputReceipts: [rawInput],
      units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
      methodology: {
        id: 'midas.open-order-normalization', version: '1.0.0',
        formula: 'remaining = reported remaining or max(amount - filled, 0); value = price * amount',
      },
      note: value.note,
    }, asOf);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Open-orders read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
      502,
    );
  }
}

export async function fetchPositions(ctx: CcxtAccountContext): Promise<AccountPositions> {
  const asOf = ctx.now();
  if (!hasAccountKeys(ctx)) {
    const value: AccountPositions = {
      source: ctx.name,
      provenance: 'unavailable',
      note:
        'Read-only positions need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
        '(use read-only keys — Midas never opens or closes positions).',
      totalUnrealizedPnlUsd: null,
      positions: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-positions', venue: ctx.exchangeId,
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
      note: value.note ?? 'Read-only positions are not configured.',
    }, asOf) };
  }
  if (!ctx.exchange.has['fetchPositions']) {
    const value: AccountPositions = {
      source: ctx.name,
      provenance: 'unavailable',
      note: `${ctx.name} does not expose a fetchPositions endpoint (spot-only account or exchange).`,
      totalUnrealizedPnlUsd: null,
      positions: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-positions', venue: ctx.exchangeId,
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
      note: value.note ?? 'Position reads are unsupported.',
    }, asOf) };
  }
  try {
    // READ-ONLY: fetchPositions only — never any order/position write method.
    const raw = await ctx.exchange.fetchPositions();
    const primaryMapping = mapPositionsWithDiagnostics(raw);
    assertUsableAccountMapping(primaryMapping, 'positions');
    let positions = primaryMapping.rows;
    let secondaryMapping: ReturnType<typeof mapPositionsWithDiagnostics> | null = null;
    const second = await fromSecondary(ctx, async (ex) => {
      if (!ex.has['fetchPositions']) return [];
      secondaryMapping = mapPositionsWithDiagnostics(await ex.fetchPositions());
      assertUsableAccountMapping(secondaryMapping, 'positions');
      return secondaryMapping.rows;
    });
    if (second) {
      positions = mergeVenueRows(positions, ctx.exchangeId, second.rows, ctx.secondary!.id, (p) => p.notionalUsd);
    }
    const value: AccountPositions = {
      source: ctx.name,
      provenance: 'live',
      note: [
        second?.note,
        accountOmissionCaveat(primaryMapping, 'position'),
        accountOmissionCaveat(secondaryMapping, 'position'),
      ].filter(Boolean).join(' ') || null,
      totalUnrealizedPnlUsd: sumUnrealizedPnl(positions),
      positions,
      asOf,
    };
    const rawInput = providerReceipt(ctx, {
      datasetFamily: 'account-positions', venue: ctx.exchangeId, provenance: 'live', sourceAsOf: null,
      coverage: 'raw configured-exchange position rows',
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
      note: value.note,
    }, asOf);
    return withProviderDerivedReceipt(ctx, value, {
      datasetFamily: 'account-positions', venue: ctx.exchangeId, provenance: 'live', sourceAsOf: null,
      inputReceipts: [rawInput],
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
      methodology: {
        id: 'midas.position-normalization', version: '1.0.0',
        formula: 'contracts = abs(reported contracts); totalUnrealizedPnlUsd = sum(known unrealizedPnlUsd)',
      },
      note: value.note,
    }, asOf);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Positions read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
      502,
    );
  }
}

export async function fetchFills(ctx: CcxtAccountContext, symbol?: string): Promise<AccountFills> {
  const asOf = ctx.now();
  if (!hasAccountKeys(ctx)) {
    const value: AccountFills = {
      source: ctx.name,
      provenance: 'unavailable',
      note:
        'Read-only fills need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
        '(read-only keys are sufficient — Midas never moves funds).',
      fills: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-fills', instrument: symbol ?? null, venue: ctx.exchangeId,
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note ?? 'Read-only fills are not configured.',
    }, asOf) };
  }
  if (!ctx.exchange.has['fetchMyTrades']) {
    const value: AccountFills = {
      source: ctx.name,
      provenance: 'unavailable',
      note: `${ctx.name} does not expose a fetchMyTrades endpoint.`,
      fills: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-fills', instrument: symbol ?? null, venue: ctx.exchangeId,
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note ?? 'Fill reads are unsupported.',
    }, asOf) };
  }
  try {
    // READ-ONLY: fetchMyTrades only. Many venues (e.g. Binance) require a
    // symbol for this endpoint — surface that honestly instead of guessing.
    const sym = symbol ? ctx.normalize(symbol) : undefined;
    const raw = await ctx.exchange.fetchMyTrades(sym, undefined, 100);
    const primaryMapping = mapMyTradesWithDiagnostics(raw);
    assertUsableAccountMapping(primaryMapping, 'fills');
    let fills = primaryMapping.rows;
    let secondaryMapping: ReturnType<typeof mapMyTradesWithDiagnostics> | null = null;
    const second = await fromSecondary(ctx, async (ex) => {
      if (!ex.has['fetchMyTrades']) return [];
      secondaryMapping = mapMyTradesWithDiagnostics(await ex.fetchMyTrades(sym, undefined, 100));
      assertUsableAccountMapping(secondaryMapping, 'fills');
      return secondaryMapping.rows;
    });
    if (second) {
      fills = mergeVenueRows(fills, ctx.exchangeId, second.rows, ctx.secondary!.id, (f) => f.timestamp);
    }
    const value: AccountFills = {
      source: ctx.name,
      provenance: 'live',
      note: [
        second?.note,
        accountOmissionCaveat(primaryMapping, 'fill'),
        accountOmissionCaveat(secondaryMapping, 'fill'),
      ].filter(Boolean).join(' ') || null,
      fills,
      asOf,
    };
    const rawInput = providerReceipt(ctx, {
      datasetFamily: 'account-fills', instrument: sym ?? null, venue: ctx.exchangeId,
      provenance: 'live', sourceAsOf: null,
      coverage: 'raw configured-exchange trade/fill rows',
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note,
    }, asOf);
    return withProviderDerivedReceipt(ctx, value, {
      datasetFamily: 'account-fills', instrument: sym ?? null, venue: ctx.exchangeId,
      provenance: 'live', sourceAsOf: null,
      inputReceipts: [rawInput],
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      methodology: {
        id: 'midas.fill-normalization', version: '1.0.0',
        formula: 'cost = reported cost or price * amount; fee fields remain null when unreported',
      },
      note: value.note,
    }, asOf);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    // Inspect the raw message internally to detect the "symbol required" case,
    // but never place it in the note — it can carry the signed request URL.
    const rawMsg = err instanceof Error ? err.message : '';
    const needsSymbol = /symbol|argument/i.test(rawMsg) && !symbol;
    if (!needsSymbol) {
      throw new ProviderError(
        `Fills read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
        502,
      );
    }
    const value: AccountFills = {
      source: ctx.name,
      provenance: 'unavailable',
      note: `${ctx.name} requires a symbol for fills — open FILLS with a symbol (e.g. BTC/USDT FILLS).`,
      fills: [],
      asOf,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'account-fills', instrument: null, venue: ctx.exchangeId,
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note ?? 'A symbol is required for fill reads.',
    }, asOf) };
  }
}

/**
 * Look up one order's current state. READ-ONLY — fetchOrder only; feeds the
 * account watcher's closed-order resolution and TICKET's status tracking.
 * The mapPlacedOrder fallbacks only apply to fields the exchange omits.
 */
export async function fetchOrder(ctx: CcxtAccountContext, id: string, symbol: string): Promise<PlacedOrder> {
  if (!ctx.exchange.has['fetchOrder']) {
    throw new ProviderError(`${ctx.name} does not support single-order lookup.`, 501);
  }
  const sym = ctx.normalize(symbol);
  try {
    const raw = await ctx.exchange.fetchOrder(id, sym);
    return mapPlacedOrder(raw, { symbol: sym, side: 'buy', type: 'limit', amount: 0, price: null });
  } catch (err) {
    // Sanitize like every other keyed read in this file — a raw ccxt error
    // embeds the signed request URL (HMAC signature / API key) and response
    // body; describe()/safeErrorLabel strip it.
    throw err instanceof ProviderError ? err : new ProviderError(ctx.describe(err, sym), 502, sym);
  }
}
