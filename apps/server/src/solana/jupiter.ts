import type { SolanaSwapHop, SolanaSwapQuote } from '@midas/shared';
import { MINT_BY_SYMBOL, MINT_DECIMALS, num, shortMint, str } from './rpc';
import { fetchJsonWithTimeout } from '../httpJson';

/**
 * Read-only Jupiter swap quotes — the SJUP panel's live source. QUOTE ONLY:
 * Midas fetches a best-route price estimate and NEVER builds, signs, or sends
 * the swap transaction, so the non-custodial "exactly two exchange writes"
 * invariant is untouched — no write path is even reachable from here. Env-gated
 * (MIDAS_SOLANA_JUPITER), default off; any failure degrades to an honest
 * `unavailable` snapshot, never a fabricated `live` price. The mapper is pure
 * and fixture-tested.
 *
 * Jupiter's quote endpoint returns amounts in RAW base units (atomic, scaled by
 * each mint's decimals) and does NOT return decimals — so the caller must know
 * them (see MINT_DECIMALS). priceImpactPct is a decimal fraction ('0.0012' =
 * 0.12%). The legacy quote-api.jup.ag/v6 endpoint is deprecated; this uses the
 * current lite-api host (no key), overridable to the keyed api.jup.ag host.
 */

const DEFAULT_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const DEFAULT_SLIPPAGE_BPS = 50;
const TIMEOUT_MS = 6000;
const MAX_HOPS = 6;

/** Is the live Jupiter quote source enabled? Gated by env; default off. */
export function jupiterEnabled(): boolean {
  const v = (process.env.MIDAS_SOLANA_JUPITER ?? '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off';
}

/** The quote endpoint: a full http(s) URL in the env overrides the default lite-api host. */
export function jupiterQuoteUrl(): string {
  const v = (process.env.MIDAS_SOLANA_JUPITER ?? '').trim();
  return v.startsWith('http') ? v : DEFAULT_QUOTE_URL;
}

/** Convert a raw base-unit amount string to whole tokens; null if unparseable. */
function fromBaseUnits(raw: unknown, decimals: number): number | null {
  const n = num(raw);
  if (n == null) return null;
  return n / 10 ** decimals;
}

/**
 * Map a Jupiter quote payload to a SolanaSwapQuote. Pure. Amounts are converted
 * from raw base units to whole tokens using the supplied decimals; price is
 * output-per-input; priceImpactPct is scaled from a fraction to a percent; the
 * route is one entry per hop (label, else a shortened pool key).
 */
export function mapSwapQuote(inputs: {
  payload: unknown;
  inputSymbol: string;
  outputSymbol: string;
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  outputDecimals: number;
  now: number;
}): SolanaSwapQuote {
  const p = (inputs.payload ?? {}) as Record<string, unknown>;
  const inAmount = fromBaseUnits(p.inAmount, inputs.inputDecimals);
  const outAmount = fromBaseUnits(p.outAmount, inputs.outputDecimals);
  const price = inAmount != null && outAmount != null && inAmount > 0 ? outAmount / inAmount : null;
  const impactFrac = num(p.priceImpactPct);
  const priceImpactPct = impactFrac == null ? null : Math.round(impactFrac * 100 * 1000) / 1000;

  const route: SolanaSwapHop[] = [];
  if (Array.isArray(p.routePlan)) {
    for (const hop of (p.routePlan as Array<Record<string, unknown>>).slice(0, MAX_HOPS)) {
      const swap = (hop.swapInfo ?? {}) as Record<string, unknown>;
      const label = str(swap.label);
      const ammKey = str(swap.ammKey);
      route.push({ dex: label || (ammKey ? shortMint(ammKey) : 'amm'), percent: num(hop.percent) });
    }
  }

  return {
    source: 'jupiter',
    provenance: 'live',
    note: null,
    inputSymbol: inputs.inputSymbol,
    outputSymbol: inputs.outputSymbol,
    inputMint: inputs.inputMint,
    outputMint: inputs.outputMint,
    inAmount,
    outAmount,
    price,
    priceImpactPct,
    slippageBps: num(p.slippageBps) ?? DEFAULT_SLIPPAGE_BPS,
    route,
    asOf: inputs.now,
  };
}

function unavailable(inputSymbol: string, outputSymbol: string, note: string): SolanaSwapQuote {
  return {
    source: jupiterEnabled() ? 'jupiter' : 'none',
    provenance: 'unavailable',
    note,
    inputSymbol,
    outputSymbol,
    inputMint: MINT_BY_SYMBOL[inputSymbol] ?? '',
    outputMint: MINT_BY_SYMBOL[outputSymbol] ?? '',
    inAmount: null,
    outAmount: null,
    price: null,
    priceImpactPct: null,
    slippageBps: null,
    route: [],
    asOf: Date.now(),
  };
}

/**
 * Fetch a live Jupiter quote for `amount` of inputSymbol → outputSymbol. Both
 * symbols must be known mints (so decimals are known); an unknown symbol or a
 * non-positive amount is an honest `unavailable`, not a guess. Read-only.
 */
export async function fetchSolanaQuote(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<SolanaSwapQuote> {
  const inSym = inputSymbol.toUpperCase();
  const outSym = outputSymbol.toUpperCase();
  if (!jupiterEnabled()) {
    return unavailable(inSym, outSym, 'Live swap quotes need Jupiter — set MIDAS_SOLANA_JUPITER=1 (read-only, quote only).');
  }
  const inputMint = MINT_BY_SYMBOL[inSym];
  const outputMint = MINT_BY_SYMBOL[outSym];
  const inputDecimals = MINT_DECIMALS[inputMint ?? ''];
  const outputDecimals = MINT_DECIMALS[outputMint ?? ''];
  if (!inputMint || !outputMint || inputDecimals == null || outputDecimals == null) {
    return unavailable(inSym, outSym, `Unknown token in ${inSym}/${outSym} — quotes cover a known-mint set only.`);
  }
  if (!(amount > 0)) {
    return unavailable(inSym, outSym, 'Enter a positive input amount to quote.');
  }
  if (inputMint === outputMint) {
    return unavailable(inSym, outSym, 'Pick two different tokens to quote a swap.');
  }

  try {
    // Amount → raw base units. `amount` is already a JS number (float), which is
    // fine for the display-scale sizes this panel quotes; BigInt just renders it
    // as an integer string for the query.
    const rawAmount = BigInt(Math.round(amount * 10 ** inputDecimals)).toString();
    const url = `${jupiterQuoteUrl()}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=${DEFAULT_SLIPPAGE_BPS}`;
    const quote = mapSwapQuote({
      payload: await fetchJsonWithTimeout(url, { timeoutMs: TIMEOUT_MS }),
      inputSymbol: inSym,
      outputSymbol: outSym,
      inputMint,
      outputMint,
      inputDecimals,
      outputDecimals,
      now: Date.now(),
    });
    // A 200 with an unusable body (no amounts) is not a live quote — degrade
    // honestly rather than render a "live" quote of all-nulls (mirrors the
    // empty-result guard in fetchSolanaMarket / fetchSolanaTrending).
    if (quote.outAmount == null) {
      return unavailable(inSym, outSym, `No route returned for ${inSym}→${outSym} at this size.`);
    }
    return quote;
  } catch (err) {
    return unavailable(inSym, outSym, `Live Jupiter quote unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}
