import { describe, it, expect, afterEach } from 'vitest';
import { mapSwapQuote, fetchSolanaQuote, jupiterEnabled } from './jupiter';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('mapSwapQuote', () => {
  it('converts raw base units, scales impact, and builds the route', () => {
    const q = mapSwapQuote({
      payload: {
        inAmount: '1000000000', // 1 SOL (9 dp)
        outAmount: '152340000', // 152.34 USDC (6 dp)
        priceImpactPct: '0.0012', // fraction → 0.12%
        slippageBps: 50,
        routePlan: [
          { swapInfo: { label: 'Orca', ammKey: 'Pool1' }, percent: 100 },
          { swapInfo: { ammKey: 'Pool2xxxxxxxxxxxxxxxxxxxx' }, percent: 0 }, // no label → shortened key
        ],
      },
      inputSymbol: 'SOL',
      outputSymbol: 'USDC',
      inputMint: SOL,
      outputMint: USDC,
      inputDecimals: 9,
      outputDecimals: 6,
      now: 1_782_000_000_000,
    });
    expect(q.provenance).toBe('live');
    expect(q.inAmount).toBe(1);
    expect(q.outAmount).toBeCloseTo(152.34, 2);
    expect(q.price).toBeCloseTo(152.34, 2); // output per 1 input
    expect(q.priceImpactPct).toBeCloseTo(0.12, 3); // fraction → percent
    expect(q.route[0].dex).toBe('Orca');
    expect(q.route[1].dex).not.toBe(''); // unlabeled hop falls back to a shortened ammKey
    expect(q.route[1].dex).toMatch(/…/);
  });

  it('is defensive against an empty payload', () => {
    const q = mapSwapQuote({
      payload: null,
      inputSymbol: 'SOL',
      outputSymbol: 'USDC',
      inputMint: SOL,
      outputMint: USDC,
      inputDecimals: 9,
      outputDecimals: 6,
      now: 1,
    });
    expect(q.inAmount).toBeNull();
    expect(q.outAmount).toBeNull();
    expect(q.price).toBeNull();
    expect(q.route).toEqual([]);
  });
});

describe('fetchSolanaQuote gate', () => {
  afterEach(() => {
    delete process.env.MIDAS_SOLANA_JUPITER;
  });

  it('is disabled by default and honest "unavailable"', async () => {
    delete process.env.MIDAS_SOLANA_JUPITER;
    expect(jupiterEnabled()).toBe(false);
    const q = await fetchSolanaQuote('SOL', 'USDC', 1);
    expect(q.provenance).toBe('unavailable');
    expect(q.note).toMatch(/MIDAS_SOLANA_JUPITER/);
  });

  it('rejects an unknown token even when enabled — never guesses a mint', async () => {
    process.env.MIDAS_SOLANA_JUPITER = '1';
    const q = await fetchSolanaQuote('SOL', 'NOTATOKEN', 1);
    expect(q.provenance).toBe('unavailable');
    expect(q.note).toMatch(/known-mint/i);
  });
});
