import { describe, it, expect, afterEach } from 'vitest';
import { mapNetwork, fetchSolanaNetwork } from './network';
import { solanaEnabled } from './rpc';

// Representative slices of real Solana JSON-RPC results.
const EPOCH_INFO = { absoluteSlot: 296_500_000, epoch: 685, slotIndex: 216_000, slotsInEpoch: 432_000 };
const SUPPLY = { value: { total: 586_000_000_000_000_000, circulating: 468_000_000_000_000_000 } };
const PERF = [{ numTransactions: 6000, samplePeriodSecs: 2 }];
const VOTES = {
  current: [{ activatedStake: 200_000_000_000_000 }, { activatedStake: 185_000_000_000_000 }],
  delinquent: [],
};

describe('mapNetwork', () => {
  it('maps a full set of RPC results to a live snapshot', () => {
    const n = mapNetwork({
      epochInfo: EPOCH_INFO,
      supply: SUPPLY,
      perfSamples: PERF,
      voteAccounts: VOTES,
      solPriceUsd: 158.4,
      now: 1_782_000_000_000,
    });
    expect(n.provenance).toBe('live');
    expect(n.note).toBeNull();
    expect(n.slot).toBe(296_500_000);
    expect(n.epoch).toBe(685);
    expect(n.epochProgressPct).toBe(50); // 216000 / 432000
    expect(n.tps).toBe(3000); // 6000 / 2
    expect(n.validatorCount).toBe(2);
    expect(n.totalStakeSol).toBe(385_000); // (200e12 + 185e12) / 1e9
    expect(n.circulatingSupplySol).toBe(468_000_000);
    expect(n.totalSupplySol).toBe(586_000_000);
    expect(n.solPriceUsd).toBe(158.4);
    expect(n.asOf).toBe(1_782_000_000_000);
  });

  it('degrades each field to null on missing/partial input, not the whole snapshot', () => {
    const n = mapNetwork({
      epochInfo: EPOCH_INFO,
      supply: null,
      perfSamples: null,
      voteAccounts: null,
      solPriceUsd: null,
      now: 1,
    });
    expect(n.provenance).toBe('live'); // epochInfo was present
    expect(n.slot).toBe(296_500_000);
    expect(n.tps).toBeNull();
    expect(n.validatorCount).toBeNull();
    expect(n.totalStakeSol).toBeNull();
    expect(n.circulatingSupplySol).toBeNull();
    expect(n.solPriceUsd).toBeNull();
  });

  it('counts total stake across current + delinquent validators (matches SVAL)', () => {
    const n = mapNetwork({
      epochInfo: EPOCH_INFO,
      supply: null,
      perfSamples: null,
      // A delinquent validator is still staked, just not voting — its stake counts.
      voteAccounts: { current: [{ activatedStake: 100_000_000_000 }], delinquent: [{ activatedStake: 20_000_000_000 }] },
      solPriceUsd: null,
      now: 1,
    });
    expect(n.validatorCount).toBe(1); // only voting validators are counted
    expect(n.totalStakeSol).toBe(120); // (100e9 + 20e9) / 1e9 — delinquent stake included
  });

  it('is defensive against garbage input (no throw, all-null metrics)', () => {
    const n = mapNetwork({ epochInfo: 'nope', supply: 42, perfSamples: {}, voteAccounts: [], solPriceUsd: null, now: 1 });
    expect(n.slot).toBeNull();
    expect(n.epoch).toBeNull();
    expect(n.epochProgressPct).toBeNull();
  });
});

describe('fetchSolanaNetwork gate', () => {
  afterEach(() => {
    delete process.env.MIDAS_SOLANA_RPC;
  });

  it('is off by default and reads honest "unavailable" — never a fake live read', async () => {
    delete process.env.MIDAS_SOLANA_RPC;
    expect(solanaEnabled()).toBe(false);
    const n = await fetchSolanaNetwork(150);
    expect(n.provenance).toBe('unavailable');
    expect(n.note).toMatch(/MIDAS_SOLANA_RPC/);
    expect(n.slot).toBeNull();
    expect(n.source).toBe('none');
  });
});
