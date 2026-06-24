import type { FastifyInstance } from 'fastify';
import type { ApiError } from '@midas/shared';
import type { AuthDeps } from './routes';
import { userIdFromRequest } from './routes';

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

    const userId = userIdFromRequest(req, deps.secret);
    if (!userId || !deps.users.findById(userId)) {
      const body: ApiError = { error: 'Unauthorized', message: 'Login required', statusCode: 401 };
      await reply.code(401).send(body);
      return reply;
    }
    (req as { userId?: string }).userId = userId;
  });
}
