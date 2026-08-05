import type { FastifyInstance } from 'fastify';
import type { ApiError } from '@midas/shared';
import type { AuthDeps } from './routes';
import { userFromRequest } from './routes';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard on authenticated requests. */
    userId?: string;
  }
}

// Open even when auth is on: health check, the auth endpoints themselves, and
// the read-only market-data stream (browsers can't set WS auth headers).
const PUBLIC_PREFIXES = ['/api/health', '/api/auth', '/api/stream'];

/**
 * Whether a path is public, matched on SEGMENT boundaries. A plain
 * `path.startsWith('/api/health')` would also whitelist a future
 * `/api/health-internal` or `/api/streamers` route — silently unauthenticated.
 * Public iff the path equals a prefix exactly or continues with a `/`.
 * Exported for tests.
 */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// Keyed exchange-account surfaces: they can be backed by real operator
// credentials (env CCXT keys), so they carry account privacy and — via
// cancel-only DELETE — account availability. Matched on SEGMENT boundaries,
// like isPublicPath. Exported for tests.
const KEYED_ACCOUNT_READ_PREFIXES = [
  '/api/balances',
  '/api/positions',
  '/api/fills',
  '/api/account/events',
  '/api/account/equity',
];

/**
 * Whether a request hits a keyed account surface. `/api/orders` is
 * method-aware: GET (open-orders read, single-order lookup) and DELETE
 * (cancel-only) are keyed, but POST must stay untouched — it is already
 * fail-closed with 503 TradingSafetyHold and that error contract must not be
 * preempted by this guard.
 */
export function isKeyedAccountPath(path: string, method: string): boolean {
  if (KEYED_ACCOUNT_READ_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  if (path === '/api/orders' || path.startsWith('/api/orders/')) {
    return method === 'GET' || method === 'DELETE';
  }
  return false;
}

/**
 * Whether a configured CORS origin is effectively a wildcard: `*` outright,
 * unset/empty (config defaults to `*`), or any `*` entry in a list. With ACAO
 * `*` the browser lets ANY web page read the API's responses cross-origin.
 */
export function corsOriginIsWildcard(corsOrigin: string): boolean {
  const value = corsOrigin.trim();
  if (value === '') return true;
  return value.split(',').some((entry) => entry.trim() === '*');
}

export interface KeyedAccountGuardDeps {
  authEnabled: boolean;
  corsOrigin: string;
}

/**
 * Fail closed in the insecure default posture. When auth is disabled AND CORS
 * is a wildcard, the keyed account surfaces (balances/orders/positions/fills/
 * equity, and cancel-only DELETE /api/orders/:id) are refused with an honest
 * 403: any web page the operator visits could otherwise read the keyed
 * account — and cancel its resting orders — cross-origin. The accepted
 * self-host postures keep working: auth ON (this guard stands down; the auth
 * guard above governs) or auth off with a PINNED non-wildcard origin (no
 * cross-origin page can talk to the API at all). Public market-data routes
 * are never touched. POST /api/orders is deliberately excluded so the 503
 * TradingSafetyHold contract stays canonical.
 */
export function installKeyedAccountGuard(app: FastifyInstance, deps: KeyedAccountGuardDeps): void {
  if (deps.authEnabled) return;
  if (!corsOriginIsWildcard(deps.corsOrigin)) return;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!isKeyedAccountPath(path, req.method)) return;

    const body: ApiError = {
      error: 'Forbidden',
      message:
        'Keyed account access (balances/orders/positions/fills/equity, order cancel) is closed while ' +
        'auth is disabled and CORS is a wildcard: with ACAO *, any web page you visit could read this ' +
        "account and cancel its resting orders cross-origin. Set MIDAS_AUTH_ENABLED=true, or pin " +
        "MIDAS_CORS_ORIGIN to your terminal's exact origin, to open it.",
      statusCode: 403,
    };
    await reply.code(403).send(body);
    return reply;
  });
}

/**
 * When auth is enabled, require a valid bearer token for every `/api/*` route
 * except the public ones, and stash the user id on the request.
 */
export function installAuthGuard(app: FastifyInstance, deps: AuthDeps): void {
  if (!deps.enabled) return;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (isPublicPath(path)) return;

    const user = userFromRequest(req, deps);
    if (!user) {
      const body: ApiError = { error: 'Unauthorized', message: 'Login required', statusCode: 401 };
      await reply.code(401).send(body);
      return reply;
    }
    req.userId = user.id;
  });
}
