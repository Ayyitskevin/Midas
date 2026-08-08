import type {
  AccountWebhookEnabledInput,
  AccountWebhookInput,
  AccountWebhookResponse,
} from '@midas/shared';
import type { FastifyInstance } from 'fastify';
import { currentDigestWatermark } from './cadence';
import type { UserWebhookRepo } from './repo';
import { resolveWebhookTarget, WebhookUrlError, type WebhookResolver } from './url';

export interface UserWebhookRouteDeps {
  /** null = operator gate off or encryption root unavailable. */
  repo: UserWebhookRepo | null;
  digestHours: number;
  fillNotificationsAvailable: (userId: string) => boolean;
  maxEnabledUsers: number;
  /** Prevent stale records for deleted owners from consuming live capacity. */
  isUserActive?: (userId: string) => boolean;
  now?: () => number;
  resolver?: WebhookResolver;
}

function response(deps: UserWebhookRouteDeps, userId: string): AccountWebhookResponse {
  return {
    webhook: deps.repo?.metaFor(userId) ?? null,
    fillNotificationsAvailable: deps.fillNotificationsAvailable(userId),
    digestHours: deps.digestHours > 0 ? Math.max(1, deps.digestHours) : null,
  };
}

/** Authenticated, write-only personal webhook configuration routes. */
export function registerUserWebhookRoutes(app: FastifyInstance, deps: UserWebhookRouteDeps): void {
  const now = deps.now ?? Date.now;
  const featureOff = {
    error: 'NotConfigured',
    message:
      'Personal webhooks are off on this server. The operator must enable MIDAS_USER_WEBHOOKS=true ' +
      'with authenticated per-user keys and encrypted storage.',
    statusCode: 501,
  };
  const needsAuth = {
    error: 'AuthRequired',
    message: 'Personal webhooks belong to an authenticated user. Sign in first.',
    statusCode: 400,
  };
  const activeEnabledCount = (): number =>
    deps.repo?.enabledUserIds().filter((userId) => {
      try {
        return deps.isUserActive?.(userId) ?? true;
      } catch {
        return false;
      }
    }).length ?? 0;

  app.get('/api/account/webhook', async (req, reply): Promise<AccountWebhookResponse | object> => {
    if (!deps.repo) return reply.status(501).send(featureOff);
    if (!req.userId) return reply.status(400).send(needsAuth);
    return response(deps, req.userId);
  });

  app.put<{ Body: AccountWebhookInput }>(
    '/api/account/webhook',
    async (req, reply): Promise<AccountWebhookResponse | object> => {
      if (!deps.repo) return reply.status(501).send(featureOff);
      if (!req.userId) return reply.status(400).send(needsAuth);
      const raw = typeof req.body?.url === 'string' ? req.body.url : '';
      let canonicalUrl: string;
      try {
        const target = await resolveWebhookTarget(raw, deps.resolver);
        canonicalUrl = target.url.toString();
      } catch (error) {
        const message =
          error instanceof WebhookUrlError
            ? error.message
            : 'Webhook URL could not be validated against the public network boundary.';
        return reply.status(400).send({ error: 'InvalidWebhook', message, statusCode: 400 });
      }
      const at = now();
      deps.repo.configure(req.userId, canonicalUrl, at, currentDigestWatermark(at, deps.digestHours));
      // Deliberately no URL/user id in the audit event.
      app.log.warn('personal webhook configured (delivery remains disabled)');
      return response(deps, req.userId);
    },
  );

  app.patch<{ Body: AccountWebhookEnabledInput }>(
    '/api/account/webhook',
    async (req, reply): Promise<AccountWebhookResponse | object> => {
      if (!deps.repo) return reply.status(501).send(featureOff);
      if (!req.userId) return reply.status(400).send(needsAuth);
      if (typeof req.body?.enabled !== 'boolean') {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'enabled must be a boolean.',
          statusCode: 400,
        });
      }
      const current = deps.repo.metaFor(req.userId);
      if (!current) {
        return reply.status(409).send({
          error: 'WebhookNotConfigured',
          message: 'Save and validate a webhook URL before enabling delivery.',
          statusCode: 409,
        });
      }
      if (req.body.enabled && !current.enabled && activeEnabledCount() >= deps.maxEnabledUsers) {
        return reply.status(409).send({
          error: 'WebhookCapacityReached',
          message: 'The operator-configured personal-webhook capacity is currently full.',
          statusCode: 409,
        });
      }
      if (req.body.enabled && deps.repo.urlFor(req.userId) == null) {
        return reply.status(409).send({
          error: 'WebhookConfigurationUnavailable',
          message: 'The saved webhook cannot be decrypted. Replace it before enabling delivery.',
          statusCode: 409,
        });
      }
      const at = now();
      deps.repo.setEnabled(
        req.userId,
        req.body.enabled,
        at,
        currentDigestWatermark(at, deps.digestHours),
      );
      app.log.warn(req.body.enabled ? 'personal webhook enabled' : 'personal webhook disabled');
      return response(deps, req.userId);
    },
  );

  app.delete('/api/account/webhook', async (req, reply): Promise<{ ok: boolean } | object> => {
    if (!deps.repo) return reply.status(501).send(featureOff);
    if (!req.userId) return reply.status(400).send(needsAuth);
    const removed = deps.repo.remove(req.userId);
    if (removed) app.log.warn('personal webhook cleared');
    return { ok: removed };
  });
}
