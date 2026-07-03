import { describe, it, expect, afterEach } from 'vitest';
import { mapTokenInfo, fetchSolanaToken } from './token';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('mapTokenInfo', () => {
  it('reads supply, decimals, program and the two authorities', () => {
    const t = mapTokenInfo({
      mint: USDC,
      supply: { value: { amount: '5000000000000', decimals: 6, uiAmountString: '5000000' } },
      accountInfo: {
        value: {
          data: {
            parsed: { info: { decimals: 6, mintAuthority: 'MintAuthority111', freezeAuthority: null }, type: 'mint' },
            program: 'spl-token',
          },
        },
      },
      priceUsd: () => null,
      now: 1_782_000_000_000,
    });
    expect(t.provenance).toBe('live');
    expect(t.symbol).toBe('USDC'); // known mint labeled
    expect(t.decimals).toBe(6);
    expect(t.supply).toBe(5_000_000);
    expect(t.program).toBe('spl-token');
    // Active mint authority (a string) → true; explicit null freeze authority → false (revoked, but read).
    expect(t.mintAuthority).toBe('MintAuthority111');
    expect(t.mintAuthorityActive).toBe(true);
    expect(t.freezeAuthority).toBeNull();
    expect(t.freezeAuthorityActive).toBe(false);
    expect(t.priceUsd).toBe(1); // USDC pinned to $1 by the stablecoin rule
  });

  it('leaves authorities unread (null) when the mint account did not decode', () => {
    const t = mapTokenInfo({
      mint: USDC,
      supply: { value: { decimals: 6, uiAmountString: '1000000' } },
      accountInfo: null, // getAccountInfo failed → best-effort
      priceUsd: () => null,
      now: 1,
    });
    expect(t.supply).toBe(1_000_000); // supply still from getTokenSupply
    expect(t.decimals).toBe(6);
    expect(t.program).toBeNull();
    // Unread ≠ revoked: the *Active flags are null, not false.
    expect(t.mintAuthorityActive).toBeNull();
    expect(t.freezeAuthorityActive).toBeNull();
  });

  it('is defensive against a garbage payload', () => {
    const t = mapTokenInfo({ mint: USDC, supply: null, accountInfo: null, priceUsd: () => null, now: 1 });
    expect(t.supply).toBeNull();
    expect(t.decimals).toBeNull();
  });
});

describe('fetchSolanaToken gate', () => {
  afterEach(() => {
    delete process.env.MIDAS_SOLANA_RPC;
  });

  it('is honest "unavailable" when no RPC is set', async () => {
    delete process.env.MIDAS_SOLANA_RPC;
    const t = await fetchSolanaToken(USDC, () => null);
    expect(t.provenance).toBe('unavailable');
    expect(t.note).toMatch(/MIDAS_SOLANA_RPC/);
    expect(t.mint).toBe(USDC);
    expect(t.supply).toBeNull();
  });
});
