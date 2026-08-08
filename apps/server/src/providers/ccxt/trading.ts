import * as ccxt from 'ccxt';
import type { CancelResult, OrderRequest, PlacedOrder } from '@midas/shared';
import { ProviderError } from '../types';
import { EXECUTION_SAFETY_HOLD_REASON } from '../../trading';
import { safeErrorLabel } from './helpers';
import type { CcxtReadContext } from './context';

// Re-exported so this module's own import sites keep working; `ccxt/context.ts`
// holds the one definition.
export type { CcxtReadContext };


/**
 * The provider-level execution safety hold, in the exact shape the route layer
 * returns for POST /api/orders (error name TradingSafetyHold, the shared
 * reason constant, 503) so clients cannot tell the two layers apart. Placement
 * only — cancellation is live under the cancel-only posture.
 */
export function tradingSafetyHold(): ProviderError {
  const err = new ProviderError(EXECUTION_SAFETY_HOLD_REASON, 503);
  err.name = 'TradingSafetyHold';
  return err;
}

/**
 * Map a failed cancel attempt to an honest outcome. The raw ccxt error message
 * is inspected ONLY for classification — it can embed the signed request URL
 * (HMAC signature / API key), so client-facing text is always rebuilt.
 *
 * - no exchange verdict (timeout/network) → 502 "outcome unknown": the cancel
 *   may or may not have landed; never claim canceled when unknown.
 * - order no longer open (filled / already canceled) → 409.
 * - any other rejection → 502: the cancel did NOT happen, order still open.
 */
export function classifyCancelError(err: unknown, id: string, symbol: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const name = err instanceof Error ? err.name : '';
  const rawMsg = err instanceof Error ? err.message : '';
  if (
    err instanceof ccxt.NetworkError ||
    ['RequestTimeout', 'ExchangeNotAvailable', 'DDoSProtection', 'NetworkError'].includes(name)
  ) {
    return new ProviderError(
      `Cancel outcome UNKNOWN for order ${id} on ${symbol} — the exchange did not confirm (${safeErrorLabel(err)}). ` +
        'Check the exchange for the true order state before assuming it is open or canceled.',
      502,
      symbol,
      'upstream-unavailable',
      'cancel-outcome-unknown',
    );
  }
  if (
    name === 'OrderNotFound' ||
    name === 'InvalidOrder' ||
    /already (filled|cancelled|canceled|closed)|order does not exist|unknown order/i.test(rawMsg)
  ) {
    return new ProviderError(
      `Order ${id} on ${symbol} is no longer open — already filled or canceled (it may also rest on another venue of this account).`,
      409,
      symbol,
    );
  }
  return new ProviderError(
    `Cancel rejected by the exchange for order ${id} on ${symbol} (${safeErrorLabel(err)}) — the order should still be open.`,
    502,
    symbol,
  );
}

/**
 * Cancel a resting order. LIVE under the cancel-only posture: the route
 * (routes/account.ts) proves the id sits in the caller's OWN open-orders
 * list before this is ever called, so this write can only reduce the
 * caller's exposure — it moves no funds, needs no notional cap.
 *
 * Outcomes are honest: exchange confirmation → CancelResult; already
 * filled/canceled → 409; timeout/network → 502 "outcome unknown" (never a
 * claimed cancel); other rejections → 502 with the order still open.
 * Errors are classified WITHOUT leaking the raw ccxt message (signed URLs).
 */
export async function cancelOrder(ctx: CcxtReadContext, id: string, symbol: string): Promise<CancelResult> {
  if (!ctx.exchange.has['cancelOrder']) {
    throw new ProviderError(`${ctx.name} does not support order cancellation.`, 501);
  }
  const sym = ctx.normalize(symbol);
  try {
    const raw = (await ctx.exchange.cancelOrder(id, sym)) as unknown as Record<string, unknown> | null;
    const o = raw ?? {};
    const strField = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      id: strField(o.id) || id,
      symbol: strField(o.symbol) || sym,
      status: strField(o.status) || 'canceled',
    };
  } catch (err) {
    throw classifyCancelError(err, id, sym);
  }
}

/**
 * Place a LIVE order. FAIL-CLOSED under the execution safety hold: throws
 * the same TradingSafetyHold shape the route layer returns (routes/account.ts).
 * Defense in depth — the POST /api/orders route returns its 503 before ever
 * reaching this method, and this provider throw guarantees no other caller
 * (present or future) can execute a live write while the hold stands.
 */
export async function placeOrder(_req: OrderRequest): Promise<PlacedOrder> {
  throw tradingSafetyHold();
}
