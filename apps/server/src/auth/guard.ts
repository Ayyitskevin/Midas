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
