import type { Exchange } from 'ccxt';
import type { DataProvider } from '../types';

/**
 * The slice of CcxtProvider the extracted `ccxt/*` readers need, beyond the
 * DataProvider surface the receipt helpers already take.
 *
 * ONE definition, shared by every extracted module. Each decomposition step
 * used to redeclare its own near-identical copy, which meant the provider's
 * obligations to its own readers were spelled out in seven places and could
 * drift silently. Later steps widen this interface (see the optional members
 * below) rather than forking it.
 *
 * Receipt identity: `withProviderReceipt(ctx, …)` must keep embedding the
 * provider's own name/capabilities, so extracted functions receive the provider
 * instance, never a bare `Exchange`. CcxtProvider satisfies this structurally.
 *
 * Symbol convention: `ctx` exposes `normalize(symbol)` and each module derives
 * its own base/perp forms from it — delegates pass the raw caller symbol, never
 * a pre-normalized one.
 *
 * Modules must never import `../ccxt`: the provider imports one-way from
 * `ccxt/*` so the graph stays acyclic.
 */
export interface CcxtReadContext extends DataProvider {
  /** Injected clock (CcxtProviderDeps.now) — extracted code never calls Date.now. */
  readonly now: () => number;
  /** BTC-USD → BTC/USD; already-unified symbols pass through. */
  normalize(symbol: string): string;
  /** The configured primary venue client. */
  readonly exchange: Exchange;
  /** Lowercased ccxt id of the primary venue (receipt `venue` field). */
  readonly exchangeId: string;
}

/**
 * The read context plus the multi-venue compare set — what the cross-venue
 * fan-outs (liquidations, quotes, venue derivatives, venue screen) need. Kept as
 * a widening of CcxtReadContext so a module asks for exactly the surface it
 * uses, and single-venue readers stay unable to reach the compare set.
 */
export interface CcxtCompareContext extends CcxtReadContext {
  /** The lazily built multi-venue compare set (MIDAS_CCXT_COMPARE). */
  compareExchanges(): Exchange[];
}
