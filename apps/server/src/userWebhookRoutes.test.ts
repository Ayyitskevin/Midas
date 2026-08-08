import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { KeyRepo } from './keys/repo';
import { UserWebhookRepo } from './userWebhooks/repo';

const KMS = 'personal-webhook-test-kms';
const AUTH = 'personal-webhook-auth-secret';
const publicResolver = async () => [{ address: '1.1.1.1', family: 4 as const }];

async function signup(app: FastifyInstance, username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { username, password: 'correct-horse' },
  });
  expect(response.statusCode).toBe(201);
  return response.json().token as string;
}

const headers = (token: string) => ({ authorization: `Bearer ${token}` });

describe('personal webhook account routes', () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function personalApp(
    logs?: string[],
    webhookRepo = new UserWebhookRepo(KMS),
  ): Promise<FastifyInstance> {
    const app = await buildApp(createProvider('mock'), {
      logger: logs
        ? { level: 'info', stream: { write: (message) => logs.push(message) } }
        : { level: 'silent' },
      auth: { enabled: true, allowSignup: true, secret: AUTH },
      keyRepo: new KeyRepo(KMS),
      userWebhookRepo: webhookRepo,
      userWebhookResolver: publicResolver,
      userWebhookTransport: { post: async () => ({ statusCode: 204 }) },
      userWebhookNow: () => 7_200_001,
    });
    apps.push(app);
    await app.ready();
    return app;
  }

  it('is authenticated, isolated, metadata-only, and disabled after every save or replacement', async () => {
    const app = await personalApp();
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const secretUrl = 'https://hooks.public.example.com/services/ALICE-SECRET';

    expect((await app.inject({ method: 'GET', url: '/api/account/webhook' })).statusCode).toBe(401);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/account/webhook',
      headers: headers(alice),
      payload: { url: secretUrl },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(secretUrl);
    expect(saved.body).not.toContain('ALICE-SECRET');
    expect(saved.json().webhook).toMatchObject({ enabled: false, lastDelivery: null });
    expect(saved.json().webhook).not.toHaveProperty('url');

    const bobView = await app.inject({
      method: 'GET',
      url: '/api/account/webhook',
      headers: headers(bob),
    });
    expect(bobView.json().webhook).toBeNull();

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/account/webhook',
      headers: headers(alice),
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().webhook.enabled).toBe(true);
    expect(enabled.body).not.toContain(secretUrl);

    const replaced = await app.inject({
      method: 'PUT',
      url: '/api/account/webhook',
      headers: headers(alice),
      payload: { url: 'https://second.public.example.com/new-secret' },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().webhook.enabled).toBe(false);
    expect(replaced.body).not.toContain('new-secret');

    const cleared = await app.inject({
      method: 'DELETE',
      url: '/api/account/webhook',
      headers: headers(alice),
    });
    expect(cleared.json()).toEqual({ ok: true });
    const after = await app.inject({
      method: 'GET',
      url: '/api/account/webhook',
      headers: headers(alice),
    });
    expect(after.json().webhook).toBeNull();
  });

  it('rejects unsafe URLs and invalid toggles without storing a target', async () => {
    const app = await personalApp();
    const token = await signup(app, 'url-user');
    const local = await app.inject({
      method: 'PUT',
      url: '/api/account/webhook',
      headers: headers(token),
      payload: { url: 'https://127.0.0.1/internal' },
    });
    expect(local.statusCode).toBe(400);
    expect(local.json()).toMatchObject({ error: 'InvalidWebhook', statusCode: 400 });

    const enable = await app.inject({
      method: 'PATCH',
      url: '/api/account/webhook',
      headers: headers(token),
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/account/webhook', headers: headers(token) })).json().webhook).toBeNull();
  });

  it('keeps endpoint secrets out of responses and structured logs', async () => {
    const logs: string[] = [];
    const app = await personalApp(logs);
    const token = await signup(app, 'privacy-user');
    const secret = 'DO-NOT-LOG-PERSONAL-ENDPOINT';
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/webhook',
      headers: headers(token),
      payload: { url: `https://hooks.public.example.com/${secret}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(logs.join('')).not.toContain(secret);
    expect(logs.join('')).not.toContain('hooks.public.example.com');
  });

  it('reports the feature gate honestly when no personal webhook repo is configured', async () => {
    const app = await buildApp(createProvider('mock'), {
      logger: { level: 'silent' },
      auth: { enabled: true, allowSignup: true, secret: AUTH },
      keyRepo: new KeyRepo(KMS),
      userWebhookRepo: null,
    });
    apps.push(app);
    await app.ready();
    const token = await signup(app, 'off-user');
    const response = await app.inject({
      method: 'GET',
      url: '/api/account/webhook',
      headers: headers(token),
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().message).toMatch(/MIDAS_USER_WEBHOOKS=true/);
  });

  it('purges the deleted user\'s encrypted endpoint without touching another account', async () => {
    const repo = new UserWebhookRepo(KMS);
    const app = await personalApp(undefined, repo);
    const admin = await signup(app, 'cleanup-admin');
    const victim = await signup(app, 'cleanup-victim');
    const keeper = await signup(app, 'cleanup-keeper');
    const victimUser = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: headers(victim) })
    ).json();
    const keeperUser = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: headers(keeper) })
    ).json();
    for (const [token, name] of [[victim, 'victim'], [keeper, 'keeper']] as const) {
      const saved = await app.inject({
        method: 'PUT',
        url: '/api/account/webhook',
        headers: headers(token),
        payload: { url: `https://${name}.public.example.com/private` },
      });
      expect(saved.statusCode).toBe(200);
    }
    expect(repo.metaFor(victimUser.id)).not.toBeNull();
    expect(repo.metaFor(keeperUser.id)).not.toBeNull();

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/auth/users/${victimUser.id}`,
      headers: headers(admin),
    });
    expect(removed.statusCode).toBe(200);
    expect(repo.metaFor(victimUser.id)).toBeNull();
    expect(repo.metaFor(keeperUser.id)).not.toBeNull();
  });

  it('refuses personal webhook state without authentication or encrypted per-user keys', async () => {
    await expect(
      buildApp(createProvider('mock'), {
        auth: { enabled: false },
        keyRepo: new KeyRepo(KMS),
        userWebhookRepo: new UserWebhookRepo(KMS),
      }),
    ).rejects.toThrow(/require authentication/i);

    await expect(
      buildApp(createProvider('mock'), {
        auth: { enabled: true, secret: AUTH },
        keyRepo: null,
        userWebhookRepo: new UserWebhookRepo(KMS),
      }),
    ).rejects.toThrow(/per-user key store/i);
  });
});
