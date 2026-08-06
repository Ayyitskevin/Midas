import type { Exchange } from 'ccxt';
import type { Balances } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import type { CcxtReadContext } from './context';

// Re-exported under the old name so this module's own import sites keep
// working; the base context lives in `ccxt/context.ts`.
export type { CcxtAccountContext as CcxtReadContext };
import { ProviderError } from '../types';
import { providerReceipt, providerUnavailableReceipt, withProviderDerivedReceipt } from '../receipts';
import { STABLES, ccxtKeysConfigured, mapCcxtBalanceWithDiagnostics, sumValueUsd, unpricedCaveat } from '../balances';
import { mergeVenueRows } from '../accountReads';
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

// Local copy of the ccxt.ts module-scope coercion helper, pending PR #361's
// shared providers/ccxt/coerce.ts (switch to importing from './coerce' once
// that lands on main).
function sourceTimestampOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
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
