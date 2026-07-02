import type { FastifyInstance } from 'fastify';
import type { KeyRepo, UserKeysMeta } from './repo';
import { isKnownExchange } from '../providers/ccxt';

// Exchange credentials are short by nature (API keys/secrets are tens to a
// couple hundred chars). Bounding each field keeps a malformed or hostile
// PUT from encrypting and persisting an arbitrary blob per user — the body
// limit (1 MiB) is the outer wall; this is the tight, per-field one.
const MAX_FIELD = 512;

/**
 * Per-user exchange key management. Write-only by design: the PUT accepts
 * credentials, the GET returns metadata (exchange + last4 + canTrade) and
 * never the secrets, the DELETE wipes in one action. Auth is a hard
 * requirement — per-user keys are meaningless without a user — and the
 * whole feature is off (honestly) until the operator sets a KMS secret.
 */

export interface KeyRouteDeps {
  /** null = feature off (no MIDAS_KEYS_KMS_SECRET configured). */
  repo: KeyRepo | null;
  /** Called after a set/delete so the provider pool drops its cached client. */
  onChanged?: (userId: string) => void;
}

interface PutBody {
  exchange?: string;
  apiKey?: string;
  secret?: string;
  password?: string;
  canTrade?: boolean;
}

export function registerKeyRoutes(app: FastifyInstance, deps: KeyRouteDeps): void {
  const featureOff = {
    error: 'NotConfigured',
    message:
      'Per-user exchange keys are not enabled on this server — the operator must set ' +
      'MIDAS_KEYS_KMS_SECRET (used to encrypt keys at rest). Self-host note: single-user ' +
      'setups can keep using the MIDAS_CCXT_API_KEY env keys unchanged.',
    statusCode: 501,
  };
  const needsAuth = {
    error: 'AuthRequired',
    message: 'Per-user keys require login — enable MIDAS_AUTH_ENABLED and sign in first.',
    statusCode: 400,
  };

  app.put<{ Body: PutBody }>('/api/account/keys', async (req, reply): Promise<UserKeysMeta | object> => {
    if (!deps.repo) return reply.status(501).send(featureOff);
    if (!req.userId) return reply.status(400).send(needsAuth);
    const b = req.body ?? {};
    const exchange = typeof b.exchange === 'string' ? b.exchange.trim().toLowerCase() : '';
    const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    const secret = typeof b.secret === 'string' ? b.secret.trim() : '';
    const password = typeof b.password === 'string' ? b.password.trim() : '';
    if (!exchange || !apiKey || !secret) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'exchange, apiKey and secret are required.',
        statusCode: 400,
      });
    }
    // Reject oversized fields before anything is encrypted or stored.
    if (apiKey.length > MAX_FIELD || secret.length > MAX_FIELD || password.length > MAX_FIELD) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: `apiKey, secret and password must each be ${MAX_FIELD} characters or fewer.`,
        statusCode: 400,
      });
    }
    // Validate the exchange against ccxt's real registry at the edge — a
    // typo or a crafted id (e.g. "constructor") is a clean 400 here, never a
    // stored record that only fails later at provider construction.
    if (!isKnownExchange(exchange)) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Unknown exchange "${exchange}". Use a ccxt exchange id (e.g. binance, coinbase, kraken).`,
        statusCode: 400,
      });
    }
    const meta = deps.repo.set(
      req.userId,
      {
        exchange,
        apiKey,
        secret,
        ...(password ? { password } : {}),
        canTrade: Boolean(b.canTrade),
      },
      Date.now(),
    );
    // Audit the event, never the material.
    app.log.warn({ userId: req.userId, exchange, keyLast4: meta.keyLast4 }, 'user exchange keys set');
    deps.onChanged?.(req.userId);
    return meta;
  });

  app.get('/api/account/keys', async (req, reply): Promise<{ keys: UserKeysMeta | null } | object> => {
    if (!deps.repo) return reply.status(501).send(featureOff);
    if (!req.userId) return reply.status(400).send(needsAuth);
    return { keys: deps.repo.metaFor(req.userId) };
  });

  app.delete('/api/account/keys', async (req, reply): Promise<{ ok: boolean } | object> => {
    if (!deps.repo) return reply.status(501).send(featureOff);
    if (!req.userId) return reply.status(400).send(needsAuth);
    const removed = deps.repo.remove(req.userId);
    if (removed) {
      app.log.warn({ userId: req.userId }, 'user exchange keys removed');
      deps.onChanged?.(req.userId);
    }
    return { ok: removed };
  });
}
