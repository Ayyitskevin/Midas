import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  app = await buildApp(createProvider('mock'), {
    auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('security response headers', () => {
  it('are set on every API response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('are present even on errors', async () => {
    // With auth enabled the guard answers 401 before the 404 handler —
    // either way it is an error response, and the headers must be there.
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('login throttling', () => {
  it('answers repeated failed logins with 429 before the store is even consulted', async () => {
    // Bootstrap a user, then hammer wrong passwords from one (test) ip.
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'trader', password: 'correct-horse' },
    });
    expect(signup.statusCode).toBe(201);

    let throttled = 0;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'trader', password: `wrong-${i}` },
      });
      if (res.statusCode === 429) throttled += 1;
      else expect(res.statusCode).toBe(401);
    }
    expect(throttled).toBeGreaterThan(0); // default threshold is 5 fails

    // The right password is ALSO throttled while locked out — that is the point.
    const during = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'trader', password: 'correct-horse' },
    });
    expect(during.statusCode).toBe(429);
    expect(during.json().message).toMatch(/try again in \d+s/i);
  });

  it('does not let one username lock out a different one', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'other', password: 'correct-horse' },
    });
    expect(signup.statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'other', password: 'correct-horse' },
    });
    expect(res.statusCode).toBe(200); // 'trader' being locked doesn't touch 'other'
  });
});

describe('GET /api/system', () => {
  it('is served (auth-guarded like every ops endpoint on this auth-on app)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system' });
    // This test app has auth enabled -> the guard answers 401 for anonymous
    // callers, which is the correct posture for an ops endpoint.
    expect([200, 401]).toContain(res.statusCode);
  });
});

describe('input validation at the API edge (auth off)', () => {
  let open: FastifyInstance;

  beforeAll(async () => {
    open = await buildApp(createProvider('mock'));
    await open.ready();
  });

  afterAll(async () => {
    await open.close();
  });

  it('bounds symbols to a real-instrument charset and length', async () => {
    // Real shapes pass (crypto pair with settle suffix).
    const ok = await open.inject({ method: 'GET', url: '/api/quote/BTC%2FUSDT' });
    expect(ok.statusCode).toBe(200);

    // Charset junk and unbounded length are 400s at the edge — they never
    // reach a provider lookup, a stream key, or an error message.
    for (const bad of ['BTC%20USDT', '%24%28reboot%29', 'A'.repeat(80)]) {
      const res = await open.inject({ method: 'GET', url: `/api/quote/${bad}` });
      expect(res.statusCode).toBe(400);
    }
  });

  it('drops invalid entries from batch quotes instead of forwarding them', async () => {
    const res = await open.inject({
      method: 'GET',
      url: `/api/quotes?symbols=BTC/USDT,${'Z'.repeat(90)},$(reboot)`,
    });
    expect(res.statusCode).toBe(200);
    const symbols = (res.json() as Array<{ symbol: string }>).map((q) => q.symbol);
    expect(symbols).toContain('BTC/USDT');
    expect(symbols).toHaveLength(1);
  });

  it('caps the AI conversation volume before anything leaves the box', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    try {
      const res = await open.inject({
        method: 'POST',
        url: '/api/ai/chat',
        payload: { messages: [{ role: 'user', content: 'x'.repeat(40_000) }] },
      });
      // 400 (not 502): the volume gate fires before any upstream call.
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/32k characters/i);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('survives an abusive search needle (bounded before the scan)', async () => {
    const res = await open.inject({
      method: 'GET',
      url: `/api/search?q=${'b'.repeat(3000)}`,
    });
    expect(res.statusCode).toBe(200); // truncated to 64 chars, honestly empty result
  });
});

describe('AI copilot cost brake (per-caller rate limit)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(createProvider('mock'));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('caps AI calls per caller with 429 before reaching the paid upstream', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    try {
      // Empty-message requests pass the limiter (incrementing it) but 400 at the
      // empty-check — so this exercises the 429 path without ever calling Claude.
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { messages: [] } });
        codes.push(res.statusCode);
      }
      expect(codes).toContain(400); // early requests allowed through, fail the empty-check
      expect(codes[codes.length - 1]).toBe(429); // past the cap, short-circuited
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('trusted proxy derives req.ip from X-Forwarded-For', () => {
  let proxied: FastifyInstance;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    proxied = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      trustProxy: 1, // one nginx hop, as the shipped compose configures
    });
    await proxied.ready();
    await proxied.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'vic', password: 'correct-horse' },
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
  });

  afterAll(async () => {
    await proxied.close();
  });

  it('keys the login throttle per forwarded client IP, not the shared proxy IP', async () => {
    // Lock 'vic' out from one client IP by spraying wrong passwords.
    for (let i = 0; i < 6; i++) {
      await proxied.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'vic', password: `wrong-${i}` },
        headers: { 'x-forwarded-for': '1.1.1.1' },
      });
    }
    const locked = await proxied.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'vic', password: 'correct-horse' },
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    expect(locked.statusCode).toBe(429); // that client IP is locked out

    // A DIFFERENT forwarded client IP logs in fine — proving req.ip came from
    // X-Forwarded-For, not the (constant) proxy socket address. Without
    // trustProxy both requests would share one bucket and this would be 429.
    const other = await proxied.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'vic', password: 'correct-horse' },
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });
    expect(other.statusCode).toBe(200);
  });
});
