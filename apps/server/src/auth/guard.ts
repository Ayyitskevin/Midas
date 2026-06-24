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
const PUBLIC_PREFIXES = ['/api/health', '/api/auth/', '/api/stream'];

/**
 * When auth is enabled, require a valid bearer token for every `/api/*` route
 * except the public ones, and stash the user id on the request.
 */
export function installAuthGuard(app: FastifyInstance, deps: AuthDeps): void {
  if (!deps.enabled) return;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return;

    const user = userFromRequest(req, deps);
    if (!user) {
      const body: ApiError = { error: 'Unauthorized', message: 'Login required', statusCode: 401 };
      await reply.code(401).send(body);
      return reply;
    }
    req.userId = user.id;
  });
}
