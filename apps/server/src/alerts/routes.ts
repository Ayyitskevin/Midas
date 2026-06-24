import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseAlertInput } from '@midas/shared';
import type { ApiError } from '@midas/shared';
import type { AlertRepo } from './repo';

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/** The authenticated user id the guard stashed, or undefined when auth is off. */
function ownerOf(req: FastifyRequest): string | undefined {
  return req.userId;
}

/** Register the server-side alert CRUD + trigger-log routes (scoped per user). */
export function registerAlertRoutes(app: FastifyInstance, repo: AlertRepo): void {
  app.get('/api/alerts', async (req) => repo.listFor(ownerOf(req)));

  app.get('/api/alerts/log', async (req) => repo.logFor(ownerOf(req)));

  app.post('/api/alerts', async (req, reply) => {
    const input = parseAlertInput(req.body);
    if (!input) {
      reply.code(400);
      return err(400, 'BadRequest', 'Invalid alert: need symbol, metric, op, value');
    }
    reply.code(201);
    return repo.create(input, Date.now(), ownerOf(req));
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; rearm?: boolean } }>(
    '/api/alerts/:id',
    async (req, reply) => {
      const updated = repo.updateFor(
        req.params.id,
        {
          enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
          rearm: req.body?.rearm === true,
        },
        ownerOf(req),
      );
      if (!updated) {
        reply.code(404);
        return err(404, 'NotFound', 'No such alert');
      }
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/alerts/:id', async (req, reply) => {
    if (!repo.removeFor(req.params.id, ownerOf(req))) {
      reply.code(404);
      return err(404, 'NotFound', 'No such alert');
    }
    return { ok: true };
  });
}
