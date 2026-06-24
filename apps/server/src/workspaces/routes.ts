import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiError } from '@midas/shared';
import type { WorkspaceRepo } from './repo';

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/** The authenticated user id the guard stashed, or undefined when auth is off. */
function ownerOf(req: FastifyRequest): string | undefined {
  return req.userId;
}

/**
 * Register the per-user workspace snapshot routes. GET returns the stored
 * snapshot (or `{ snapshot: null }` for a new user); PUT replaces it with the
 * client blob and returns the server-stamped time so the client can track what
 * it last synced. The payload is opaque to the server — the client owns it.
 */
export function registerWorkspaceRoutes(app: FastifyInstance, repo: WorkspaceRepo): void {
  app.get('/api/workspaces', async (req) => ({ snapshot: repo.get(ownerOf(req)) }));

  app.put('/api/workspaces', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      reply.code(400);
      return err(400, 'BadRequest', 'Expected a JSON workspace snapshot object');
    }
    const snapshot = repo.set(ownerOf(req), body, Date.now());
    return { ok: true, updatedAt: snapshot.updatedAt };
  });
}
