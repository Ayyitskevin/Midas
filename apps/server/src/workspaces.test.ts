import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';
import { buildApp } from './app';
import { WorkspaceRepo } from './workspaces/repo';
import { UserRepo } from './auth/users';

/** Minimal provider — workspace routes never touch it. */
function stubProvider(): DataProvider {
  return {
    name: 'stub',
    live: false,
    getQuote: async (symbol: string) => ({ symbol, price: 1, changePercent: 0 }),
    getQuotes: async () => [],
    getHistory: async () => {
      throw new Error('not implemented');
    },
    getOrderBook: async () => {
      throw new Error('not implemented');
    },
    getExchangeQuotes: async () => [],
    getDerivatives: async () => {
      throw new Error('not implemented');
    },
    screen: async () => [],
    search: async () => [],
    getNews: async () => [],
  } as unknown as DataProvider;
}

describe('WorkspaceRepo', () => {
  it('returns null before anything is stored, then the stamped blob', () => {
    const repo = new WorkspaceRepo();
    expect(repo.get()).toBeNull();

    const saved = repo.set(undefined, { panels: [1, 2, 3] }, 1000);
    expect(saved.updatedAt).toBe(1000);
    expect(repo.get()).toEqual({ blob: { panels: [1, 2, 3] }, updatedAt: 1000 });
  });

  it('scopes snapshots per user and keeps `@local` separate', () => {
    const repo = new WorkspaceRepo();
    repo.set('alice', { who: 'alice' }, 1);
    repo.set('bob', { who: 'bob' }, 2);
    repo.set(undefined, { who: 'local' }, 3);

    expect(repo.get('alice')?.blob).toEqual({ who: 'alice' });
    expect(repo.get('bob')?.blob).toEqual({ who: 'bob' });
    expect(repo.get()?.blob).toEqual({ who: 'local' });
  });
});

describe('workspaces API (auth off)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), { workspaceRepo: new WorkspaceRepo() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('round-trips a snapshot through PUT then GET', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshot).toBeNull();

    const put = await app.inject({
      method: 'PUT',
      url: '/api/workspaces',
      payload: { layout: 'grid', panels: [{ id: 'p1' }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().ok).toBe(true);
    expect(typeof put.json().updatedAt).toBe('number');

    res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.json().snapshot.blob).toEqual({ layout: 'grid', panels: [{ id: 'p1' }] });
  });

  it('rejects a non-object body with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/workspaces',
      payload: JSON.stringify('nope'),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized snapshot with an honest 413 (disk-fill guard)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/workspaces',
      payload: { pad: 'x'.repeat(600 * 1024) }, // > 512 KiB serialized, < the 1 MiB body limit
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('SnapshotTooLarge');
    expect(res.json().message).toMatch(/file export/i);

    // The stored snapshot was not replaced by the rejected write.
    const after = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(JSON.stringify(after.json().snapshot?.blob ?? null)).not.toContain('xxxx');
  });
});

describe('per-user workspace isolation', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  const hdr = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(stubProvider(), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      workspaceRepo: new WorkspaceRepo(),
    });
    await app.ready();
    const signup = async (username: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/signup',
          payload: { username, password: 'pw1234' },
        })
      ).json().token as string;
    tokenA = await signup('alice');
    tokenB = await signup('bob');
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth and keeps each user’s workspace private', async () => {
    // Guard rejects an unauthenticated request.
    const anon = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(anon.statusCode).toBe(401);

    // Alice stores her layout.
    await app.inject({
      method: 'PUT',
      url: '/api/workspaces',
      headers: hdr(tokenA),
      payload: { owner: 'alice' },
    });

    // Bob has nothing yet…
    const bobEmpty = await app.inject({ method: 'GET', url: '/api/workspaces', headers: hdr(tokenB) });
    expect(bobEmpty.json().snapshot).toBeNull();

    // …and storing his own doesn't disturb Alice's.
    await app.inject({
      method: 'PUT',
      url: '/api/workspaces',
      headers: hdr(tokenB),
      payload: { owner: 'bob' },
    });

    const aliceGet = await app.inject({ method: 'GET', url: '/api/workspaces', headers: hdr(tokenA) });
    expect(aliceGet.json().snapshot.blob).toEqual({ owner: 'alice' });

    const bobGet = await app.inject({ method: 'GET', url: '/api/workspaces', headers: hdr(tokenB) });
    expect(bobGet.json().snapshot.blob).toEqual({ owner: 'bob' });
  });
});
