import { describe, it, expect, afterEach } from 'vitest';
import { mapValidators, mapStaking, fetchSolanaValidators, fetchSolanaStaking } from './staking';

const LAMPORTS = 1_000_000_000;
const VOTE_ACCOUNTS = {
  current: [
    { votePubkey: 'VoteA', nodePubkey: 'NodeAAAAAAAAAAAAAAAAA', activatedStake: 300_000 * LAMPORTS, commission: 5, lastVote: 296_000_100 },
    { votePubkey: 'VoteB', nodePubkey: 'NodeBBBBBBBBBBBBBBBBB', activatedStake: 100_000 * LAMPORTS, commission: 8, lastVote: 296_000_090 },
  ],
  delinquent: [
    { votePubkey: 'VoteC', nodePubkey: 'NodeCCCCCCCCCCCCCCCCC', activatedStake: 20_000 * LAMPORTS, commission: 10, lastVote: 295_000_000 },
  ],
};

describe('mapValidators', () => {
  it('ranks by stake, computes share, flags delinquency', () => {
    const v = mapValidators(VOTE_ACCOUNTS, 1_782_000_000_000);
    expect(v.provenance).toBe('live');
    expect(v.validatorCount).toBe(2);
    expect(v.delinquentCount).toBe(1);
    expect(v.totalStakeSol).toBe(420_000); // 300k + 100k + 20k
    // sorted by stake desc
    expect(v.validators[0].votePubkey).toBe('VoteA');
    expect(v.validators[0].activatedStakeSol).toBe(300_000);
    expect(v.validators[0].stakeSharePct).toBeCloseTo(71.43, 1); // 300k/420k
    expect(v.validators[0].delinquent).toBe(false);
    expect(v.validators[0].identity).toMatch(/…/); // shortened
    const c = v.validators.find((x) => x.votePubkey === 'VoteC');
    expect(c?.delinquent).toBe(true);
  });

  it('is defensive against an empty/garbage payload', () => {
    const v = mapValidators(null, 1);
    expect(v.validators).toEqual([]);
    expect(v.validatorCount).toBe(0);
    expect(v.totalStakeSol).toBeNull();
  });
});

describe('mapStaking', () => {
  it('computes nominal (inflation ÷ staked ratio) and real (compounded) APY', () => {
    const s = mapStaking({
      inflation: { total: 0.0455 },
      supply: { value: { total: 600_000_000 * LAMPORTS } },
      totalStakeLamports: 390_000_000 * LAMPORTS, // 65% staked
      now: 1_782_000_000_000,
    });
    expect(s.provenance).toBe('live');
    expect(s.inflationPct).toBeCloseTo(4.6, 1);
    expect(s.stakedRatioPct).toBeCloseTo(65, 0);
    // nominal = 0.0455 / 0.65 = 0.07 = 7.0%
    expect(s.nominalApyPct).toBeCloseTo(7.0, 1);
    // real compounds a touch higher than nominal
    expect(s.realApyPct!).toBeGreaterThan(s.nominalApyPct!);
    expect(s.epochsPerYear).toBe(182);
  });

  it('nulls fields it cannot derive rather than inventing them', () => {
    const s = mapStaking({ inflation: null, supply: null, totalStakeLamports: null, now: 1 });
    expect(s.inflationPct).toBeNull();
    expect(s.stakedRatioPct).toBeNull();
    expect(s.nominalApyPct).toBeNull();
    expect(s.realApyPct).toBeNull();
  });
});

describe('fetch gates default off', () => {
  afterEach(() => {
    delete process.env.MIDAS_SOLANA_RPC;
  });

  it('validators + staking are honest "unavailable" when no RPC is set', async () => {
    delete process.env.MIDAS_SOLANA_RPC;
    const v = await fetchSolanaValidators();
    expect(v.provenance).toBe('unavailable');
    expect(v.note).toMatch(/MIDAS_SOLANA_RPC/);
    expect(v.validators).toEqual([]);
    const s = await fetchSolanaStaking();
    expect(s.provenance).toBe('unavailable');
    expect(s.nominalApyPct).toBeNull();
  });
});
