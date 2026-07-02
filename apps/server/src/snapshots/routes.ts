import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiError } from '@midas/shared';
import type { UserSnapshotRepo } from './repo';

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/** Per-snapshot ceiling (serialized). Exported for tests. */
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

/** The authenticated user id the guard stashed, or undefined when auth is off. */
function ownerOf(req: FastifyRequest): string | undefined {
  return req.userId;
}

/**
 * Register a per-user snapshot endpoint pair at `basePath`. GET returns the
 * stored snapshot (or `{ snapshot: null }` for a new user); PUT replaces it with
 * the client blob and returns the server-stamped time so the client can track
 * what it last synced. The payload is opaque to the server — the client owns it.
 * Used for both `/api/workspaces` and `/api/portfolio`.
 */
export function registerSnapshotRoutes(
  app: FastifyInstance,
  repo: UserSnapshotRepo,
  basePath: string,
): void {
  app.get(basePath, async (req) => ({ snapshot: repo.get(ownerOf(req)) }));

  app.put(basePath, async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      reply.code(400);
      return err(400, 'BadRequest', 'Expected a JSON snapshot object');
    }
    // The blob is opaque but not unbounded: it is persisted to disk per user,
    // so without a ceiling repeated writes are a disk-fill vector. 512 KiB is
    // ~10× the largest real desk we've seen; beyond that, file export is the
    // honest path (and the client says so).
    if (JSON.stringify(body).length > MAX_SNAPSHOT_BYTES) {
      reply.code(413);
      return err(
        413,
        'SnapshotTooLarge',
        `Snapshot exceeds ${Math.floor(MAX_SNAPSHOT_BYTES / 1024)} KB — use file export/import for desks this large.`,
      );
    }
    const snapshot = repo.set(ownerOf(req), body, Date.now());
    return { ok: true, updatedAt: snapshot.updatedAt };
  });
}
