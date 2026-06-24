import { describe, it, expect } from 'vitest';
import type { DataProvider } from './providers';
import { buildApp } from './app';
import { NotesRepo } from './notes/repo';
import { UserRepo } from './auth/users';

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

describe('notes API', () => {
  it('round-trips notes (auth off) and 400s a non-object body', async () => {
    process.env.LOG_LEVEL = 'silent';
    const app = await buildApp(stubProvider(), { notesRepo: new NotesRepo() });
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/api/notes' })).json().snapshot).toBeNull();

    const blob = { notes: { '__global__': { text: 'hi', updatedAt: 1 } } };
    expect((await app.inject({ method: 'PUT', url: '/api/notes', payload: blob })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/notes' })).json().snapshot.blob).toEqual(blob);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/notes',
      payload: JSON.stringify('nope'),
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('keeps each user’s notes private', async () => {
    process.env.LOG_LEVEL = 'silent';
    const app = await buildApp(stubProvider(), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      userRepo: new UserRepo(),
      notesRepo: new NotesRepo(),
    });
    await app.ready();
    const hdr = (t: string) => ({ authorization: `Bearer ${t}` });
    const signup = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: u, password: 'pw1234' } })).json().token as string;
    const a = await signup('alice');
    const b = await signup('bob');

    expect((await app.inject({ method: 'GET', url: '/api/notes' })).statusCode).toBe(401);
    await app.inject({ method: 'PUT', url: '/api/notes', headers: hdr(a), payload: { notes: { x: { text: 'a' } } } });
    expect((await app.inject({ method: 'GET', url: '/api/notes', headers: hdr(b) })).json().snapshot).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/notes', headers: hdr(a) })).json().snapshot.blob.notes.x.text).toBe('a');
    await app.close();
  });
});
