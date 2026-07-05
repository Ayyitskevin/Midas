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
    const owner = ownerOf(req);
    // Account-metric alerts (equity/uPnL) are only evaluated in single-user mode:
    // the global loop can't read one user's account without leaking the
    // operator's (see alerts/engine.ts). Under multi-user auth nothing evaluates
    // them, so reject creation rather than persist an alert that can never fire.
    if (owner != null && (input.metric === 'equity' || input.metric === 'upnl')) {
      reply.code(400);
      return err(
        400,
        'BadRequest',
        'Account alerts (equity/uPnL) run only in single-user mode; they are not available for individual accounts yet.',
      );
    }
    if (repo.atCapacityFor(owner)) {
      reply.code(429);
      return err(429, 'TooManyRequests', 'Alert limit reached — delete some alerts before adding more.');
    }
    reply.code(201);
    return repo.create(input, Date.now(), owner);
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
