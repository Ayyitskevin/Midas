import { describe, it, expect, afterEach } from 'vitest';
import { mapWallet, fetchSolanaWallet } from './wallet';

const ADDR = 'So11111111111111111111111111111111111111112';

// A getTokenAccountsByOwner (jsonParsed) slice: a known stable, a known token,
// an unknown mint, and a zero-balance account (should be dropped).
const TOKEN_ACCOUNTS = {
  value: [
    { account: { data: { parsed: { info: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: { uiAmount: 1250.5 } } } } } },
    { account: { data: { parsed: { info: { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', tokenAmount: { uiAmount: 400 } } } } } },
    { account: { data: { parsed: { info: { mint: 'UnknownMintAddr1111111111111111111111111111', tokenAmount: { uiAmount: 9 } } } } } },
    { account: { data: { parsed: { info: { mint: 'ZeroBalMint111111111111111111111111111111111', tokenAmount: { uiAmount: 0 } } } } } },
  ],
};

describe('mapWallet', () => {
  it('maps balance + token accounts, prices SOL and stables, sorts by value', () => {
    const w = mapWallet({
      address: ADDR,
      balanceLamports: 5_000_000_000, // 5 SOL
      tokenAccounts: TOKEN_ACCOUNTS,
      priceUsd: (sym) => (sym === 'SOL' ? 150 : null),
      now: 1_782_000_000_000,
    });
    expect(w.provenance).toBe('live');
    expect(w.note).toBeNull();
    expect(w.address).toBe(ADDR);
    expect(w.solBalance).toBe(5);

    // USDC (labeled + priced at $1), JUP (labeled, unpriced), UNKNOWN (shortened, unpriced).
    // Zero-balance account dropped.
    expect(w.tokens).toHaveLength(3);
    const usdc = w.tokens.find((t) => t.symbol === 'USDC');
    expect(usdc?.amount).toBe(1250.5);
    expect(usdc?.valueUsd).toBe(1250.5);
    const jup = w.tokens.find((t) => t.symbol === 'JUP');
    expect(jup?.valueUsd).toBeNull(); // no price supplied for JUP → honest null
    const unknown = w.tokens.find((t) => t.mint.startsWith('Unknown'));
    expect(unknown?.symbol).toMatch(/…/); // shortened mint
    expect(unknown?.valueUsd).toBeNull();

    // USDC (priced, top) sorts before the unpriced rows.
    expect(w.tokens[0].symbol).toBe('USDC');
    // total = 5 SOL * 150 + 1250.5 USDC = 2000.5
    expect(w.totalValueUsd).toBe(2000.5);
  });

  it('leaves total null when nothing can be priced', () => {
    const w = mapWallet({
      address: ADDR,
      balanceLamports: 1_000_000_000,
      tokenAccounts: { value: [] },
      priceUsd: () => null, // SOL unpriced
      now: 1,
    });
    expect(w.solBalance).toBe(1);
    expect(w.tokens).toHaveLength(0);
    expect(w.totalValueUsd).toBeNull();
  });

  it('is defensive against malformed token-account payloads', () => {
    const w = mapWallet({ address: ADDR, balanceLamports: null, tokenAccounts: 'nope', priceUsd: () => 1, now: 1 });
    expect(w.solBalance).toBeNull();
    expect(w.tokens).toEqual([]);
    expect(w.totalValueUsd).toBeNull();
  });
});

describe('fetchSolanaWallet gate', () => {
  afterEach(() => {
    delete process.env.MIDAS_SOLANA_RPC;
  });

  it('is off by default and reads honest "unavailable"', async () => {
    delete process.env.MIDAS_SOLANA_RPC;
    const w = await fetchSolanaWallet(ADDR, () => 150);
    expect(w.provenance).toBe('unavailable');
    expect(w.note).toMatch(/MIDAS_SOLANA_RPC/);
    expect(w.address).toBe(ADDR);
    expect(w.solBalance).toBeNull();
    expect(w.tokens).toEqual([]);
  });
});
