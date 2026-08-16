/**
 * Characterization of the CORS boundary, written to survive a plugin major.
 *
 * `MIDAS_CORS_ORIGIN` feeds two independent consumers: `@fastify/cors`, which
 * decides what `access-control-allow-origin` a browser sees, and
 * `installKeyedAccountGuard`, which reads the same string itself to decide
 * whether keyed account surfaces fail closed (`auth/guard.ts`). Nothing makes
 * those two agree — so a change in how the plugin interprets `origin` could
 * open the browser-visible boundary while the guard still believes it is
 * pinned, or vice versa. That divergence is the risk these tests exist to pin.
 *
 * Before this file the entire server suite asserted the emitted header exactly
 * once, as `toBeTruthy()` (`depWave.regression.test.ts`), which cannot tell
 * `*` apart from a specific origin — precisely the distinction the
 * `SECURITY_HARDENING` matrix treats as load-bearing.
 *
 * These assertions describe behavior the terminal depends on, not behavior the
 * plugin happens to have. Written and verified against @fastify/cors v10 first,
 * so a green run on a later major is evidence the contract held rather than
 * evidence the tests were fitted to it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { corsOriginIsWildcard } from './auth/guard';

const PINNED = 'https://terminal.example';
const OTHER = 'https://evil.example';

async function appWithCors(corsOrigin: string): Promise<FastifyInstance> {
  process.env.LOG_LEVEL = 'silent';
  const app = await buildApp(createProvider('mock'), { corsOrigin });
  await app.ready();
  return app;
}

describe('CORS boundary: wildcard posture', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithCors('*');
  });
  afterAll(async () => {
    await app.close();
  });

  it('emits a literal wildcard, not the caller\'s origin reflected back', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: OTHER },
    });
    expect(res.statusCode).toBe(200);
    // Reflecting the caller's origin instead of `*` would look equivalent in a
    // browser but is materially different: combined with
    // access-control-allow-credentials it would permit credentialed
    // cross-origin reads, which a literal `*` never does.
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('does not allow credentials while the origin is a wildcard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: OTHER },
    });
    // `*` plus allow-credentials is rejected by browsers, and enabling it would
    // mean someone had pinned an origin reflection somewhere.
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('CORS boundary: pinned posture', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithCors(PINNED);
  });
  afterAll(async () => {
    await app.close();
  });

  it('echoes the pinned origin for a matching caller', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: PINNED },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(PINNED);
  });

  it('answers a stranger with the pinned origin, never the stranger\'s own', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: OTHER },
    });
    // A string `origin` is a STATIC allow-list of one: the plugin emits it
    // verbatim and does no server-side matching. Enforcement is the browser's
    // — it compares ACAO against its own origin and blocks the mismatch.
    // So the security-relevant properties are what ACAO is NOT.
    expect(res.headers['access-control-allow-origin']).toBe(PINNED);
    expect(res.headers['access-control-allow-origin']).not.toBe(OTHER);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers a preflight for the pinned origin and advertises the method', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/orders/demo-1?symbol=BTC/USDT',
      headers: {
        origin: PINNED,
        'access-control-request-method': 'DELETE',
      },
    });
    // Cancel-only DELETE is a real cross-origin call from the terminal; if
    // preflight stops advertising it, cancel breaks in the browser while every
    // server-side test still passes. @fastify/cors v11 narrowed its default
    // `methods` to the safelisted GET,HEAD,POST and did exactly that, which is
    // why app.ts now states the list explicitly.
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(PINNED);
    expect(String(res.headers['access-control-allow-methods'] ?? '')).toContain('DELETE');
  });

  it('advertises every method the API actually serves', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { origin: PINNED, 'access-control-request-method': 'GET' },
    });
    const allowed = String(res.headers['access-control-allow-methods'] ?? '')
      .split(',')
      .map((m) => m.trim().toUpperCase());
    // Derived from the routes the server registers (GET/POST/PUT/PATCH/DELETE;
    // HEAD rides with GET). A route added under a method missing here would
    // work in tests and fail only in a browser, cross-origin.
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowed, `preflight must advertise ${method}`).toContain(method);
    }
  });

  it('does not hand a stranger a preflight naming the stranger', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/orders/demo-1?symbol=BTC/USDT',
      headers: {
        origin: OTHER,
        'access-control-request-method': 'DELETE',
      },
    });
    // Same static-header rule on the preflight path: the stranger is told the
    // pinned origin is allowed, which its browser will reject for itself.
    expect(res.headers['access-control-allow-origin']).toBe(PINNED);
    expect(res.headers['access-control-allow-origin']).not.toBe(OTHER);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('CORS boundary: the guard and the plugin read the same string', () => {
  it('agrees with the plugin that `*` is wildcard', async () => {
    expect(corsOriginIsWildcard('*')).toBe(true);
    const app = await appWithCors('*');
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: OTHER },
      });
      // Guard says wildcard; plugin emits `*`. The two agree.
      expect(res.headers['access-control-allow-origin']).toBe('*');
    } finally {
      await app.close();
    }
  });

  it('agrees with the plugin that a pinned origin is not wildcard', async () => {
    expect(corsOriginIsWildcard(PINNED)).toBe(false);
    const app = await appWithCors(PINNED);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: OTHER },
      });
      // Guard says pinned; the plugin never widens to `*` and never names the
      // stranger. The two agree that this deployment is not wildcard.
      expect(res.headers['access-control-allow-origin']).toBe(PINNED);
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      await app.close();
    }
  });

  it('never emits a wildcard for a value the guard treats as pinned', async () => {
    // The guard splits on commas; the plugin does not, treating the whole
    // string as one literal origin. That mismatch is tolerable in exactly one
    // direction: the plugin must not be MORE permissive than the guard assumes.
    // A comma list is pinned per the guard, so no caller may receive `*`.
    const list = `${PINNED},https://second.example`;
    expect(corsOriginIsWildcard(list)).toBe(false);
    const app = await appWithCors(list);
    try {
      for (const origin of [PINNED, 'https://second.example', OTHER]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/health',
          headers: { origin },
        });
        expect(res.headers['access-control-allow-origin']).not.toBe('*');
      }
    } finally {
      await app.close();
    }
  });
});
