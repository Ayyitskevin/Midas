import { describe, it, expect } from 'vitest';
import { createTtlCache } from './ttlCache';

describe('createTtlCache', () => {
  it('serves a cached value within the TTL and recomputes once it expires', async () => {
    let clock = 1000;
    let computes = 0;
    const cache = createTtlCache<number>(100, () => clock);
    const compute = async () => ++computes;

    expect(await cache.get('k', compute)).toBe(1);
    clock = 1050; // within TTL → cached, no recompute
    expect(await cache.get('k', compute)).toBe(1);
    expect(computes).toBe(1);
    clock = 1200; // past TTL → recompute
    expect(await cache.get('k', compute)).toBe(2);
    expect(computes).toBe(2);
  });

  it('collapses concurrent misses on the same key into one computation', async () => {
    let computes = 0;
    const cache = createTtlCache<number>(100, () => 0);
    const compute = async () => {
      computes += 1;
      await Promise.resolve();
      return 42;
    };
    const results = await Promise.all([cache.get('k', compute), cache.get('k', compute), cache.get('k', compute)]);
    expect(results).toEqual([42, 42, 42]);
    expect(computes).toBe(1);
  });

  it('does not cache a rejected computation — the next call retries', async () => {
    let calls = 0;
    const cache = createTtlCache<number>(100, () => 0);
    await expect(
      cache.get('k', async () => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await cache.get('k', async () => {
        calls += 1;
        return 7;
      }),
    ).toBe(7);
    expect(calls).toBe(2);
  });

  it('evicts an expired entry on access rather than leaving it to linger', async () => {
    let clock = 0;
    const cache = createTtlCache<number>(100, () => clock);
    await cache.get('k', async () => 1);
    clock = 200; // expired
    let recomputed = false;
    await cache.get('k', async () => {
      recomputed = true;
      return 2;
    });
    expect(recomputed).toBe(true);
  });

  it('bounds the number of stored keys — a junk-key spray cannot grow it without limit', async () => {
    // Small cap + a huge TTL so nothing expires: only the max-entries bound can
    // keep the map from growing. maxEntries = 3.
    const cache = createTtlCache<number>(10_000, () => 0, 3);
    for (let i = 0; i < 50; i++) {
      await cache.get(`k${i}`, async () => i);
    }
    // The oldest key was evicted → recomputing it runs compute again.
    let oldRecomputed = false;
    await cache.get('k0', async () => {
      oldRecomputed = true;
      return 0;
    });
    expect(oldRecomputed).toBe(true);
    // A very recent key is still cached → compute must NOT run.
    let recentRecomputed = false;
    await cache.get('k49', async () => {
      recentRecomputed = true;
      return 49;
    });
    expect(recentRecomputed).toBe(false);
  });
});
