import type { SolanaTokenInfo } from '@midas/shared';
import {
  KNOWN_MINTS,
  STABLE_SYMBOLS,
  jsonRpc,
  num,
  shortMint,
  solanaEnabled,
  solanaRpcUrl,
  str,
} from './rpc';

/**
 * Read-only SPL token (mint) explorer — the SPL panel's live source. Assembled
 * from getTokenSupply + getAccountInfo (jsonParsed) reads only, so it is
 * non-custodial by construction: no key, no signing, no write path. Env-gated
 * (MIDAS_SOLANA_RPC), default off, degrading to an honest `unavailable`
 * snapshot on any failure. The mapper is pure and defensive — the only
 * unit-tested piece. Pricing is a caller-supplied lookup so the mapper stays IO-free.
 */

/** Prices a token symbol to USD, or null when it can't be sourced. */
export type PriceUsd = (symbol: string) => number | null;

function sourceLabel(): string {
  try {
    return `rpc:${new URL(solanaRpcUrl()).host}`;
  } catch {
    return 'rpc';
  }
}

function unavailable(mint: string, note: string): SolanaTokenInfo {
  return {
    source: solanaEnabled() ? sourceLabel() : 'none',
    provenance: 'unavailable',
    note,
    mint,
    symbol: KNOWN_MINTS[mint] ?? shortMint(mint),
    program: null,
    decimals: null,
    supply: null,
    mintAuthority: null,
    mintAuthorityActive: null,
    freezeAuthority: null,
    freezeAuthorityActive: null,
    priceUsd: null,
    asOf: Date.now(),
  };
}

/**
 * Map raw getTokenSupply + getAccountInfo results to a SolanaTokenInfo. Pure and
 * defensive. Supply/decimals come from getTokenSupply; the mint + freeze
 * authorities and program come from the parsed mint account — each authority is
 * a tri-state: a base-58 string (active), null-and-read (revoked), or unread
 * (the account-info call failed) which leaves the *Active flag null.
 */
export function mapTokenInfo(inputs: {
  mint: string;
  supply: unknown; // getTokenSupply result: { value: { amount, decimals, uiAmountString } }
  accountInfo: unknown; // getAccountInfo jsonParsed: { value: { data: { parsed: { info }, program } } }
  priceUsd: PriceUsd;
  now: number;
}): SolanaTokenInfo {
  const symbol = KNOWN_MINTS[inputs.mint] ?? shortMint(inputs.mint);

  // getTokenSupply → value.{ decimals, uiAmountString }. uiAmountString is the
  // decimals-scaled supply as a string; prefer it over the deprecated uiAmount.
  const supplyValue = ((inputs.supply ?? {}) as Record<string, unknown>).value as Record<string, unknown> | undefined;
  const decimals = num(supplyValue?.decimals);
  const supply = num(supplyValue?.uiAmountString);

  // getAccountInfo (jsonParsed) → value.data.{ parsed: { info }, program }.
  const acctValue = ((inputs.accountInfo ?? {}) as Record<string, unknown>).value as Record<string, unknown> | undefined;
  const data = (acctValue?.data ?? undefined) as Record<string, unknown> | undefined;
  const parsed = (data?.parsed ?? undefined) as Record<string, unknown> | undefined;
  const info = (parsed?.info ?? undefined) as Record<string, unknown> | undefined;
  const program = data ? str(data.program) || null : null;

  // A mint account was actually decoded → the authorities are known (a string
  // means active, an explicit null means revoked). No decode → leave them unread.
  const mintRead = info != null;
  const mintAuthority = mintRead ? (typeof info.mintAuthority === 'string' ? info.mintAuthority : null) : null;
  const freezeAuthority = mintRead ? (typeof info.freezeAuthority === 'string' ? info.freezeAuthority : null) : null;

  const price = STABLE_SYMBOLS.has(symbol) ? 1 : inputs.priceUsd(symbol);

  return {
    source: sourceLabel(),
    provenance: 'live',
    note: null,
    mint: inputs.mint,
    symbol,
    program,
    decimals,
    supply,
    mintAuthority,
    mintAuthorityActive: mintRead ? mintAuthority != null : null,
    freezeAuthority,
    freezeAuthorityActive: mintRead ? freezeAuthority != null : null,
    priceUsd: price,
    asOf: inputs.now,
  };
}

/**
 * Fetch a live SPL token snapshot for a mint. getTokenSupply is the anchor (a
 * bad mint errors → unavailable); getAccountInfo is best-effort so a missing
 * mint-account decode nulls the authorities without sinking the snapshot.
 */
export async function fetchSolanaToken(mint: string, priceUsd: PriceUsd): Promise<SolanaTokenInfo> {
  if (!solanaEnabled()) {
    return unavailable(mint, 'Live Solana data needs an RPC node — set MIDAS_SOLANA_RPC to inspect a token.');
  }
  try {
    const supply = await jsonRpc('getTokenSupply', [mint, { commitment: 'finalized' }]);
    const accountInfo = await jsonRpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'finalized' }]).catch(
      () => null,
    );
    return mapTokenInfo({ mint, supply, accountInfo, priceUsd, now: Date.now() });
  } catch (err) {
    return unavailable(mint, `Live Solana RPC unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}
