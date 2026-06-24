import type { FastifyInstance } from 'fastify';
import { parseAlertInput } from '@midas/shared';
import type { ApiError } from '@midas/shared';
import type { AlertRepo } from './repo';

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/** Register the server-side alert CRUD + trigger-log routes. */
export function registerAlertRoutes(app: FastifyInstance, repo: AlertRepo): void {
  app.get('/api/alerts', async () => repo.list());

  app.get('/api/alerts/log', async () => repo.log());

  app.post('/api/alerts', async (req, reply) => {
    const input = parseAlertInput(req.body);
    if (!input) {
      reply.code(400);
      return err(400, 'BadRequest', 'Invalid alert: need symbol, metric, op, value');
    }
    reply.code(201);
    return repo.create(input, Date.now());
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; rearm?: boolean } }>(
    '/api/alerts/:id',
    async (req, reply) => {
      const updated = repo.update(req.params.id, {
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        rearm: req.body?.rearm === true,
      });
      if (!updated) {
        reply.code(404);
        return err(404, 'NotFound', 'No such alert');
      }
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/alerts/:id', async (req, reply) => {
    if (!repo.remove(req.params.id)) {
      reply.code(404);
      return err(404, 'NotFound', 'No such alert');
    }
    return { ok: true };
  });
}
