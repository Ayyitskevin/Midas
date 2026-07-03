import { describe, it, expect, afterEach, vi } from 'vitest';
import { mapWallet, fetchSolanaWallet } from './wallet';

const ADDR = 'So11111111111111111111111111111111111111112';
const SPL_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

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

  it('prefers uiAmountString so a huge balance (null uiAmount) is not silently dropped', () => {
    const w = mapWallet({
      address: ADDR,
      balanceLamports: 0,
      // Solana returns uiAmount:null when the value is too large to represent as a
      // float; uiAmountString still carries it. The holding must not be dropped.
      tokenAccounts: {
        value: [
          {
            account: {
              data: {
                parsed: { info: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: { uiAmount: null, uiAmountString: '123456.75' } } },
              },
            },
          },
        ],
      },
      priceUsd: () => null,
      now: 1,
    });
    expect(w.tokens).toHaveLength(1);
    expect(w.tokens[0].amount).toBe(123456.75); // read from uiAmountString
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
    vi.unstubAllGlobals();
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

  it('queries BOTH token programs and merges classic + Token-2022 holdings', async () => {
    process.env.MIDAS_SOLANA_RPC = 'https://rpc.example';
    const seen: string[] = [];
    // Stub the RPC: return one holding per token program, keyed on programId, so a
    // wallet with a Token-2022 mint (e.g. PYUSD) is no longer silently empty.
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body) as { method: string; params: unknown[] };
      if (req.method === 'getBalance') return jsonRes({ result: { value: 2_000_000_000 } });
      if (req.method === 'getTokenAccountsByOwner') {
        const programId = (req.params[1] as { programId: string }).programId;
        seen.push(programId);
        const mint =
          programId === TOKEN_2022
            ? 'PYUSD2022Mint111111111111111111111111111111'
            : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC (classic)
        return jsonRes({ result: { value: [{ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: '10' } } } } } }] } });
      }
      return jsonRes({ result: null });
    });

    const w = await fetchSolanaWallet(ADDR, (s) => (s === 'SOL' ? 100 : null));
    expect(w.provenance).toBe('live');
    expect(seen).toEqual(expect.arrayContaining([SPL_PROGRAM, TOKEN_2022])); // both programs queried
    expect(w.tokens.map((t) => t.mint)).toEqual(
      expect.arrayContaining(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'PYUSD2022Mint111111111111111111111111111111']),
    );
  });
});
