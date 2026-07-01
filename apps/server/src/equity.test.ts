import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { AccountPositions, Balances } from '@midas/shared';
import { EquityRepo, composeEquityPoint, registerEquityRoute, startEquityLoop } from './equity';
import type { DataProvider } from './providers';

const balances = (over: Partial<Balances> = {}): Balances => ({
  source: 'stub',
  provenance: 'live',
  note: null,
  totalValueUsd: 1000,
  balances: [],
  asOf: 0,
  ...over,
});

const positions = (over: Partial<AccountPositions> = {}): AccountPositions => ({
  source: 'stub',
  provenance: 'live',
  note: null,
  totalUnrealizedPnlUsd: 25,
  positions: [],
  asOf: 0,
  ...over,
});

describe('composeEquityPoint', () => {
  it('captures value + uPnL from live reads', () => {
    expect(composeEquityPoint(balances(), positions(), 7)).toEqual({
      at: 7,
      totalUsd: 1000,
      unrealizedPnlUsd: 25,
    });
  });

  it('refuses non-live balances (a gap is truthful; a synthetic point is not)', () => {
    expect(composeEquityPoint(balances({ provenance: 'unavailable' }), positions(), 7)).toBeNull();
    expect(composeEquityPoint(balances({ provenance: 'synthetic' }), positions(), 7)).toBeNull();
    expect(composeEquityPoint(balances({ totalValueUsd: null }), positions(), 7)).toBeNull();
  });

  it('keeps the point but nulls uPnL when positions are not live', () => {
    const p = composeEquityPoint(balances(), positions({ provenance: 'unavailable' }), 7);
    expect(p?.totalUsd).toBe(1000);
    expect(p?.unrealizedPnlUsd).toBeNull();
  });
});

describe('EquityRepo', () => {
  it('persists points to disk and reloads them', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-eq-')), 'equity.json');
    const repo = new EquityRepo(file);
    repo.add({ at: 1, totalUsd: 100, unrealizedPnlUsd: null });
    repo.add({ at: 2, totalUsd: 110, unrealizedPnlUsd: 5 });
    const reloaded = new EquityRepo(file);
    expect(reloaded.points()).toHaveLength(2);
    expect(reloaded.points()[1].totalUsd).toBe(110);
  });
});

describe('equity loop + route', () => {
  const stubProvider = (b: Balances, p: AccountPositions): DataProvider =>
    ({
      name: 'stub',
      live: true,
      getBalances: async () => b,
      getPositions: async () => p,
    }) as unknown as DataProvider;

  it('snapshots on tick and serves the series with watching:true', async () => {
    const repo = new EquityRepo();
    // Drive one tick manually via a tiny interval, then stop.
    const loop = startEquityLoop(repo, stubProvider(balances(), positions()), 5, undefined, () => 42);
    await new Promise((r) => setTimeout(r, 30));
    loop.stop();
    expect(repo.points().length).toBeGreaterThan(0);
    expect(repo.points()[0]).toEqual({ at: 42, totalUsd: 1000, unrealizedPnlUsd: 25 });

    const app = Fastify();
    registerEquityRoute(app, { repo, watching: true });
    const res = (await app.inject({ method: 'GET', url: '/api/account/equity' })).json();
    expect(res.watching).toBe(true);
    expect(res.points.length).toBeGreaterThan(0);
    await app.close();
  });

  it('skips non-live reads and stays honest when off', async () => {
    const repo = new EquityRepo();
    const loop = startEquityLoop(
      repo,
      stubProvider(balances({ provenance: 'unavailable' }), positions()),
      5,
    );
    await new Promise((r) => setTimeout(r, 25));
    loop.stop();
    expect(repo.points()).toHaveLength(0); // outage → gap, not a fake point

    const app = Fastify();
    registerEquityRoute(app, null);
    const res = (await app.inject({ method: 'GET', url: '/api/account/equity' })).json();
    expect(res.watching).toBe(false);
    expect(res.note).toMatch(/MIDAS_EQUITY_SNAP_MS/);
    await app.close();
  });
});
