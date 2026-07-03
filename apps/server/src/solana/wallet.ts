import type { SolanaTokenHolding, SolanaWallet } from '@midas/shared';
import {
  KNOWN_MINTS,
  LAMPORTS_PER_SOL,
  SPL_TOKEN_PROGRAM,
  STABLE_SYMBOLS,
  TOKEN_2022_PROGRAM,
  jsonRpc,
  num,
  shortMint,
  solanaEnabled,
  solanaSourceLabel as sourceLabel,
  str,
} from './rpc';

/**
 * Read-only Solana wallet inspector — the SWAL panel's live source. Keyed ONLY
 * by a public base-58 address (getBalance + getTokenAccountsByOwner, both
 * read-only), so it is non-custodial by construction: no key, no signing, no
 * write path exists. Env-gated (MIDAS_SOLANA_RPC), default off, degrading to an
 * honest `unavailable` snapshot on any failure. The pricing of a holding is a
 * caller-supplied lookup — the mapper stays pure.
 */

/** Prices a holding symbol to USD, or null when it can't be sourced. */
export type PriceUsd = (symbol: string) => number | null;

function unavailable(address: string, note: string): SolanaWallet {
  return {
    source: solanaEnabled() ? sourceLabel() : 'none',
    provenance: 'unavailable',
    note,
    address,
    solBalance: null,
    tokens: [],
    totalValueUsd: null,
    asOf: Date.now(),
  };
}

/**
 * Map raw RPC results to a SolanaWallet. Pure and defensive — the only unit-
 * tested piece. `priceUsd` prices SOL and known stablecoins; anything else is
 * honestly left unpriced (valueUsd: null) rather than guessed.
 */
export function mapWallet(inputs: {
  address: string;
  balanceLamports: unknown;
  tokenAccounts: unknown;
  priceUsd: PriceUsd;
  now: number;
}): SolanaWallet {
  const lamports = num(inputs.balanceLamports);
  const solBalance = lamports == null ? null : lamports / LAMPORTS_PER_SOL;
  const solPrice = inputs.priceUsd('SOL');

  const tokens: SolanaTokenHolding[] = [];
  // getTokenAccountsByOwner (jsonParsed) → { value: [{ account: { data: { parsed:
  // { info: { mint, tokenAmount: { uiAmountString } } } } } }] }. The classic SPL
  // and Token-2022 program accounts share this shape (both are merged upstream).
  const value = ((inputs.tokenAccounts ?? {}) as Record<string, unknown>).value;
  if (Array.isArray(value)) {
    for (const raw of value as Array<Record<string, unknown>>) {
      const info = (
        ((((raw.account as Record<string, unknown>)?.data as Record<string, unknown>)?.parsed as Record<
          string,
          unknown
        >)?.info ?? {}) as Record<string, unknown>
      );
      const mint = str(info.mint);
      if (!mint) continue;
      // Prefer uiAmountString: uiAmount is a JSON number Solana returns as null for
      // balances too large to represent as a float, which would silently drop the holding.
      const ta = (info.tokenAmount ?? {}) as Record<string, unknown>;
      const uiAmount = num(ta.uiAmountString) ?? num(ta.uiAmount);
      if (uiAmount == null || uiAmount === 0) continue; // skip dust / closed accounts
      const symbol = KNOWN_MINTS[mint] ?? shortMint(mint);
      const price = STABLE_SYMBOLS.has(symbol) ? 1 : inputs.priceUsd(symbol);
      tokens.push({
        mint,
        symbol,
        amount: uiAmount,
        valueUsd: price == null ? null : price * uiAmount,
      });
    }
  }
  tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const solValue = solBalance != null && solPrice != null ? solBalance * solPrice : null;
  const tokenValue = tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
  const anyPriced = solValue != null || tokens.some((t) => t.valueUsd != null);
  const totalValueUsd = anyPriced ? (solValue ?? 0) + tokenValue : null;

  return {
    source: sourceLabel(),
    provenance: 'live',
    note: null,
    address: inputs.address,
    solBalance,
    tokens,
    totalValueUsd,
    asOf: inputs.now,
  };
}

/**
 * Fetch a live Solana wallet snapshot for a public address. Honest `unavailable`
 * when the source is off or the balance read fails; token accounts are
 * best-effort (their failure yields an empty token list, not a dead panel).
 */
export async function fetchSolanaWallet(address: string, priceUsd: PriceUsd): Promise<SolanaWallet> {
  if (!solanaEnabled()) {
    return unavailable(address, 'Live Solana data needs an RPC node — set MIDAS_SOLANA_RPC to inspect a wallet.');
  }
  try {
    const balance = await jsonRpc<{ value?: unknown }>('getBalance', [address]);
    // Query BOTH token programs — classic SPL and Token-2022 — and merge, so a
    // wallet holding only Token-2022 mints isn't silently shown as empty. Each is
    // best-effort: a failure drops that half without sinking the snapshot.
    const [classic, token2022] = await Promise.all([
      jsonRpc<{ value?: unknown }>('getTokenAccountsByOwner', [address, { programId: SPL_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]).catch(() => null),
      jsonRpc<{ value?: unknown }>('getTokenAccountsByOwner', [address, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed' }]).catch(() => null),
    ]);
    const accts = (r: { value?: unknown } | null): unknown[] => (Array.isArray(r?.value) ? (r.value as unknown[]) : []);
    return mapWallet({
      address,
      balanceLamports: (balance as { value?: unknown })?.value,
      tokenAccounts: { value: [...accts(classic), ...accts(token2022)] },
      priceUsd,
      now: Date.now(),
    });
  } catch (err) {
    return unavailable(address, `Live Solana RPC unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}
