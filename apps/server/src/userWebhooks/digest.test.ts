import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AccountFill, AccountPosition, Quote } from '@midas/shared';
import { EquityRepo } from '../equity';
import type { DataProvider } from '../providers';
import { createUserDigestLoop } from './digest';
import type { UserWebhookDispatcher, UserWebhookPayload } from './delivery';
import type { DigestWebhookPayload } from './payload';
import { UserWebhookRepo } from './repo';

const HOUR = 3_600_000;
const KMS = 'digest-loop-test-kms-secret';

interface Enqueued {
  userId: string;
  payload: UserWebhookPayload;
  preclaimed: boolean;
}

function captureDispatcher(
  result: 'queued' | 'disabled' | 'full' = 'queued',
): { dispatcher: UserWebhookDispatcher; enqueued: Enqueued[] } {
  const enqueued: Enqueued[] = [];
  return {
    enqueued,
    dispatcher: {
      enqueue(userId, payload, preclaimed = false) {
        enqueued.push({ userId, payload, preclaimed });
        return result;
      },
      whenIdle: async () => {},
      pending: () => 0,
    },
  };
}

function enabledRepo(
  users: string[],
  currentWindowEnd = 0,
  file?: string,
): UserWebhookRepo {
  const repo = new UserWebhookRepo(KMS, file);
  for (const userId of users) {
    repo.configure(userId, `https://${userId}.hooks.vendor.com/incoming`, 1, currentWindowEnd);
    repo.setEnabled(userId, true, 2, currentWindowEnd);
  }
  return repo;
}

function digestPayload(entry: Enqueued): DigestWebhookPayload {
  if (entry.payload.type !== 'midas.account.digest') throw new Error('expected a digest payload');
  return entry.payload;
}

const fill = (symbol: string, cost: number): AccountFill => ({
  id: `${symbol}-fill`,
  orderId: null,
  symbol,
  side: 'buy',
  price: cost,
  amount: 1,
  cost,
  fee: null,
  feeCurrency: null,
  takerOrMaker: null,
  timestamp: 25 * HOUR,
});

const position = (symbol: string): AccountPosition => ({
  symbol,
  side: 'long',
  contracts: 1,
  notionalUsd: null,
  entryPrice: null,
  markPrice: null,
  unrealizedPnlUsd: null,
  pnlPct: null,
  liquidationPrice: null,
  leverage: null,
});

const quote = (symbol: string, changePercent: number): Quote => ({
  symbol,
  name: symbol,
  currency: 'USD',
  exchange: 'test',
  marketState: 'REGULAR',
  price: 100,
  previousClose: 100,
  open: null,
  dayHigh: null,
  dayLow: null,
  change: 0,
  changePercent,
  volume: null,
  marketCap: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  asOf: 0,
});

function liveProvider(symbol: string, cost: number, move: number): DataProvider {
  return {
    getFills: async () => ({
      source: 'test',
      provenance: 'live' as const,
      note: null,
      fills: [fill(symbol, cost)],
      asOf: 49 * HOUR,
    }),
    getPositions: async () => ({
      source: 'test',
      provenance: 'live' as const,
      note: null,
      positions: [position(symbol)],
      totalUnrealizedPnlUsd: null,
      asOf: 49 * HOUR,
    }),
    getQuote: async () => quote(symbol, move),
  } as never;
}

describe('personal digest loop', () => {
  it('uses fixed epoch-aligned completed windows and claims before account lookup', async () => {
    const now = 49 * HOUR + 123;
    const repo = enabledRepo(['alice']);
    const { dispatcher, enqueued } = captureDispatcher();
    const claimObserved: Array<unknown> = [];
    const providerFor = vi.fn((userId: string) => {
      claimObserved.push(repo.metaFor(userId)?.lastDelivery);
      return null;
    });
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => now,
    });

    await loop.tick();
    loop.stop();

    expect(providerFor).toHaveBeenCalledWith('alice');
    expect(claimObserved).toEqual([
      expect.objectContaining({ kind: 'digest', outcome: 'pending', failureCategory: null, at: now }),
    ]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].preclaimed).toBe(true);
    expect(digestPayload(enqueued[0]).window).toEqual({
      start: 24 * HOUR,
      end: 48 * HOUR,
      hours: 24,
    });
  });

  it('does not repeat a window on another tick or after reloading durable state', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-digest-')), 'webhooks.json');
    const now = 49 * HOUR;
    const repo = enabledRepo(['alice'], 0, file);
    const first = captureDispatcher();
    const firstProvider = vi.fn(() => null);
    const firstLoop = createUserDigestLoop({
      repo,
      dispatcher: first.dispatcher,
      providerFor: firstProvider,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => now,
    });

    await firstLoop.tick();
    await firstLoop.tick();
    firstLoop.stop();

    expect(first.enqueued).toHaveLength(1);
    expect(firstProvider).toHaveBeenCalledTimes(1);
    expect(repo.metaFor('alice')?.lastDelivery).toMatchObject({ kind: 'digest', outcome: 'pending' });

    const restartedRepo = new UserWebhookRepo(KMS, file);
    const restarted = captureDispatcher();
    const restartedProvider = vi.fn(() => null);
    const restartedLoop = createUserDigestLoop({
      repo: restartedRepo,
      dispatcher: restarted.dispatcher,
      providerFor: restartedProvider,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => now,
    });

    await restartedLoop.tick();
    restartedLoop.stop();

    expect(restarted.enqueued).toHaveLength(0);
    expect(restartedProvider).not.toHaveBeenCalled();
    expect(restartedRepo.metaFor('alice')?.lastDelivery).toMatchObject({
      kind: 'digest',
      outcome: 'pending',
    });
  });

  it('delivers a newly completed cadence window with a different deterministic id', async () => {
    let now = 25 * HOUR;
    const repo = enabledRepo(['alice']);
    const { dispatcher, enqueued } = captureDispatcher();
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor: () => null,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => now,
    });

    await loop.tick();
    now = 49 * HOUR;
    await loop.tick();
    loop.stop();

    expect(enqueued).toHaveLength(2);
    expect(enqueued.map((entry) => digestPayload(entry).window.end)).toEqual([24 * HOUR, 48 * HOUR]);
    expect(enqueued[0].payload.deliveryId).not.toBe(enqueued[1].payload.deliveryId);
    expect(enqueued.every((entry) => entry.payload.deliveryId.startsWith('digest-v1-'))).toBe(true);
  });

  it('uses only each user\'s provider and equity series', async () => {
    const repo = enabledRepo(['alice', 'bob']);
    const aliceEquity = new EquityRepo();
    aliceEquity.add({ at: 23 * HOUR, totalUsd: 100, unrealizedPnlUsd: 0 });
    aliceEquity.add({ at: 47 * HOUR, totalUsd: 110, unrealizedPnlUsd: 0 });
    const bobEquity = new EquityRepo();
    bobEquity.add({ at: 23 * HOUR, totalUsd: 500, unrealizedPnlUsd: 0 });
    bobEquity.add({ at: 47 * HOUR, totalUsd: 450, unrealizedPnlUsd: 0 });
    const providers: Record<string, DataProvider> = {
      alice: liveProvider('ALICE/USDT', 111, 7),
      bob: liveProvider('BOB/USDT', 222, -3),
    };
    const providerFor = vi.fn((userId: string) => providers[userId] ?? null);
    const equityRepoFor = vi.fn((userId: string) =>
      userId === 'alice' ? aliceEquity : userId === 'bob' ? bobEquity : null,
    );
    const { dispatcher, enqueued } = captureDispatcher();
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor,
      digestHours: 24,
      maxUsers: 5,
      now: () => 49 * HOUR,
    });

    await loop.tick();
    loop.stop();

    expect(providerFor.mock.calls.map(([userId]) => userId)).toEqual(['alice', 'bob']);
    expect(equityRepoFor.mock.calls.map(([userId]) => userId)).toEqual(['alice', 'bob']);
    const byUser = Object.fromEntries(enqueued.map((entry) => [entry.userId, digestPayload(entry)]));
    expect(byUser.alice.recap).toMatchObject({
      equity: { startUsd: 100, endUsd: 110 },
      fills: { buyNotionalUsd: 111 },
      movers: { items: [{ symbol: 'ALICE/USDT', changePercent: 7 }] },
    });
    expect(byUser.bob.recap).toMatchObject({
      equity: { startUsd: 500, endUsd: 450 },
      fills: { buyNotionalUsd: 222 },
      movers: { items: [{ symbol: 'BOB/USDT', changePercent: -3 }] },
    });
    expect(JSON.stringify(byUser.alice)).not.toContain('BOB/USDT');
    expect(JSON.stringify(byUser.bob)).not.toContain('ALICE/USDT');
    expect(byUser.alice.deliveryId).not.toBe(byUser.bob.deliveryId);
  });

  it('skips disabled users and emits explicit unavailable evidence for an enabled user without account reads', async () => {
    const repo = new UserWebhookRepo(KMS);
    repo.configure('disabled', 'https://disabled.hooks.vendor.com/incoming', 1, 0);
    repo.configure('enabled', 'https://enabled.hooks.vendor.com/incoming', 1, 0);
    repo.setEnabled('enabled', true, 2, 0);
    const providerFor = vi.fn(() => null);
    const equityRepoFor = vi.fn(() => null);
    const { dispatcher, enqueued } = captureDispatcher();
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor,
      digestHours: 24,
      maxUsers: 5,
      now: () => 25 * HOUR,
    });

    await loop.tick();
    loop.stop();

    expect(providerFor).toHaveBeenCalledTimes(1);
    expect(providerFor).toHaveBeenCalledWith('enabled');
    expect(equityRepoFor).toHaveBeenCalledWith('enabled');
    expect(enqueued.map(({ userId }) => userId)).toEqual(['enabled']);
    expect(digestPayload(enqueued[0]).recap).toEqual({
      equity: { state: 'unavailable' },
      fills: { state: 'unavailable' },
      movers: { state: 'unavailable', items: [] },
    });
    expect(digestPayload(enqueued[0]).text).toContain('Equity: unavailable');
    expect(JSON.stringify(enqueued[0].payload)).not.toMatch(/startUsd":0|count":0/);
  });

  it('skips an inactive owner before claiming a window or reading account evidence', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-inactive-owner-')), 'webhooks.json');
    enabledRepo(['deleted'], 0, file);
    // Simulate a restart with a retained webhook record after the auth owner
    // was durably removed.
    const repo = new UserWebhookRepo(KMS, file);
    const providerFor = vi.fn(() => null);
    const { dispatcher, enqueued } = captureDispatcher();
    let active = false;
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => 25 * HOUR,
      isUserActive: () => active,
    });

    await loop.tick();
    expect(providerFor).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
    expect(repo.metaFor('deleted')?.lastDelivery).toBeNull();

    // The skipped window was not claimed; if ownership becomes valid again,
    // the same completed window remains eligible exactly once.
    active = true;
    await loop.tick();
    loop.stop();
    expect(providerFor).toHaveBeenCalledWith('deleted');
    expect(enqueued.map(({ userId }) => userId)).toEqual(['deleted']);
  });

  it('serializes account composition and caps fan-out before touching excess users', async () => {
    const repo = enabledRepo(['alice', 'bob', 'carol']);
    const calls: string[] = [];
    let releaseAlice!: () => void;
    const aliceFills = new Promise<void>((resolve) => {
      releaseAlice = resolve;
    });
    const providerFor = vi.fn((userId: string) => {
      calls.push(`provider:${userId}`);
      return {
        getFills: async () => {
          calls.push(`fills:start:${userId}`);
          if (userId === 'alice') await aliceFills;
          calls.push(`fills:end:${userId}`);
          return { source: 'test', provenance: 'live' as const, note: null, fills: [], asOf: 25 * HOUR };
        },
        getPositions: async () => ({
          source: 'test',
          provenance: 'live' as const,
          note: null,
          positions: [],
          totalUnrealizedPnlUsd: 0,
          asOf: 25 * HOUR,
        }),
        getQuote: async (symbol: string) => quote(symbol, 0),
      } as never;
    });
    const capacity: number[] = [];
    const { dispatcher, enqueued } = captureDispatcher();
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 2,
      now: () => 25 * HOUR,
      onCapacity: (omitted) => capacity.push(omitted),
    });

    const ticking = loop.tick();
    await vi.waitFor(() => expect(calls).toContain('fills:start:alice'));
    expect(calls).not.toContain('provider:bob');
    expect(calls).not.toContain('provider:carol');
    expect(capacity.length).toBeGreaterThanOrEqual(1);
    expect(capacity.every((omitted) => omitted === 1)).toBe(true);

    releaseAlice();
    await ticking;
    loop.stop();

    expect(calls.indexOf('fills:end:alice')).toBeLessThan(calls.indexOf('provider:bob'));
    expect(calls).not.toContain('provider:carol');
    expect(enqueued.map(({ userId }) => userId)).toEqual(['alice', 'bob']);
  });

  it('honors an operator cap of zero without claiming or reading any user', async () => {
    const repo = enabledRepo(['alice']);
    const providerFor = vi.fn(() => null);
    const capacity: number[] = [];
    const { dispatcher, enqueued } = captureDispatcher();
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 0,
      now: () => 25 * HOUR,
      onCapacity: (omitted) => capacity.push(omitted),
    });

    await loop.tick();
    loop.stop();

    expect(capacity.length).toBeGreaterThanOrEqual(1);
    expect(capacity.every((omitted) => omitted === 1)).toBe(true);
    expect(providerFor).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
    expect(repo.metaFor('alice')?.lastDelivery).toBeNull();
  });

  it('records a configuration failure when enqueue observes a disable race after the durable claim', async () => {
    const repo = enabledRepo(['alice']);
    const { dispatcher, enqueued } = captureDispatcher('disabled');
    const errors: unknown[] = [];
    const loop = createUserDigestLoop({
      repo,
      dispatcher,
      providerFor: () => null,
      equityRepoFor: () => null,
      digestHours: 24,
      maxUsers: 5,
      now: () => 25 * HOUR,
      onError: (error) => errors.push(error),
    });

    await loop.tick();
    loop.stop();

    expect(enqueued).toHaveLength(1);
    expect(repo.metaFor('alice')?.lastDelivery).toEqual({
      kind: 'digest',
      outcome: 'failed',
      failureCategory: 'configuration',
      at: 25 * HOUR,
    });
    expect(errors).toEqual([]);
  });
});
