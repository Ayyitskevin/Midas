import { describe, expect, it, vi } from 'vitest';
import type { AccountWebhookFailureCategory } from '@midas/shared';
import { createUserWebhookDispatcher } from './delivery';
import { buildFillWebhookPayload, type FillWebhookPayload } from './payload';
import { UserWebhookRepo } from './repo';
import {
  MAX_USER_WEBHOOK_PAYLOAD_BYTES,
  PinnedHttpsWebhookTransport,
  UserWebhookTransportError,
  type UserWebhookRequestFactory,
  type UserWebhookTransport,
} from './transport';
import type { ResolvedAddress, WebhookResolver } from './url';

const KMS = 'delivery-test-kms-secret';
const publicResolver: WebhookResolver = async () => [{ address: '1.1.1.1', family: 4 }];

function payload(id: number, over: Partial<FillWebhookPayload> = {}): FillWebhookPayload {
  const built = buildFillWebhookPayload([
    {
      id,
      at: 1_700_000_000_000 + id,
      kind: 'fill',
      orderId: `private-order-${id}`,
      symbol: 'BTC/USDT',
      side: 'buy',
      price: 42_000,
      amount: 1,
      filled: 0.5,
      filledDelta: 0.5,
      status: 'open',
    },
  ]);
  if (!built) throw new Error('test payload must contain a fill');
  return { ...built, ...over };
}

function enabledRepo(...users: Array<{ id: string; url?: string }>): UserWebhookRepo {
  const repo = new UserWebhookRepo(KMS);
  for (const user of users) {
    repo.configure(user.id, user.url ?? `https://${user.id}.hooks.vendor.com/incoming`, 1, 0);
    repo.setEnabled(user.id, true, 2, 0);
  }
  return repo;
}

describe('personal webhook dispatcher', () => {
  it('posts once to the re-resolved, pinned target and exposes only sanitized success status', async () => {
    const repo = enabledRepo({ id: 'alice', url: 'https://alice.hooks.vendor.com/incoming?opaque=1' });
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 204 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver: publicResolver,
      transport: { post },
      now: () => 123,
      onResult: (result) => results.push(result),
    });
    const body = payload(1);

    expect(dispatcher.enqueue('alice', body)).toBe('queued');
    await dispatcher.whenIdle();

    expect(post).toHaveBeenCalledTimes(1);
    const [target, serialized, deliveryId] = post.mock.calls[0];
    expect(target).toMatchObject({
      hostname: 'alice.hooks.vendor.com',
      address: '1.1.1.1',
      family: 4,
    });
    expect(target.url.toString()).toBe('https://alice.hooks.vendor.com/incoming?opaque=1');
    expect(JSON.parse(serialized)).toEqual(body);
    expect(deliveryId).toBe(body.deliveryId);
    expect(repo.metaFor('alice')?.lastDelivery).toEqual({
      kind: 'fills',
      outcome: 'delivered',
      failureCategory: null,
      at: 123,
    });
    expect(results).toEqual([{ kind: 'fills', outcome: 'delivered', category: null }]);
    expect(JSON.stringify(results)).not.toMatch(/alice|hooks\.vendor|incoming|private-order|BTC/);
  });

  it('keeps users isolated to their own encrypted target', async () => {
    const repo = enabledRepo(
      { id: 'alice', url: 'https://alice.hooks.vendor.com/a' },
      { id: 'bob', url: 'https://bob.hooks.vendor.com/b' },
    );
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 200 });
    const dispatcher = createUserWebhookDispatcher({ repo, resolver: publicResolver, transport: { post } });

    dispatcher.enqueue('alice', payload(1));
    dispatcher.enqueue('bob', payload(2));
    await dispatcher.whenIdle();

    expect(post.mock.calls.map(([target]) => target.url.pathname).sort()).toEqual(['/a', '/b']);
    expect(post.mock.calls.map(([target]) => target.hostname).sort()).toEqual([
      'alice.hooks.vendor.com',
      'bob.hooks.vendor.com',
    ]);
  });

  it.each<{
    label: string;
    response?: number | null;
    error?: Error;
    category: AccountWebhookFailureCategory;
  }>([
    { label: 'malformed null status', response: null, category: 'malformed-response' },
    { label: 'redirect', response: 302, category: 'redirect' },
    { label: 'client rejection', response: 429, category: 'http-4xx' },
    { label: 'server failure', response: 503, category: 'http-5xx' },
    {
      label: 'timeout',
      error: new UserWebhookTransportError('timeout'),
      category: 'timeout',
    },
    {
      label: 'malformed transport result',
      error: new UserWebhookTransportError('malformed-response'),
      category: 'malformed-response',
    },
    { label: 'unknown network failure', error: new Error('raw socket secret'), category: 'network' },
  ])('classifies $label once without retrying or surfacing raw failures', async ({ response, error, category }) => {
    const repo = enabledRepo({ id: 'alice' });
    const post = vi.fn<UserWebhookTransport['post']>();
    if (error) post.mockRejectedValue(error);
    else post.mockResolvedValue({ statusCode: response ?? null });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver: publicResolver,
      transport: { post },
      now: () => 456,
      onResult: (result) => results.push(result),
    });

    dispatcher.enqueue('alice', payload(1));
    await dispatcher.whenIdle();
    await Promise.resolve();

    expect(post).toHaveBeenCalledTimes(1);
    expect(repo.metaFor('alice')?.lastDelivery).toEqual({
      kind: 'fills',
      outcome: 'failed',
      failureCategory: category,
      at: 456,
    });
    expect(results).toEqual([{ kind: 'fills', outcome: 'failed', category }]);
    expect(JSON.stringify(results)).not.toContain('raw socket secret');
  });

  it('revalidates DNS on every attempt and refuses a hostname that now resolves privately', async () => {
    const repo = enabledRepo({ id: 'alice' });
    const rebound = vi.fn(async (): Promise<ResolvedAddress[]> => [
      { address: '169.254.169.254', family: 4 },
    ]);
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 200 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver: rebound,
      transport: { post },
      onResult: (result) => results.push(result),
    });

    dispatcher.enqueue('alice', payload(1));
    await dispatcher.whenIdle();

    expect(rebound).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect(results).toEqual([{ kind: 'fills', outcome: 'failed', category: 'blocked-target' }]);
  });

  it('honors disablement while DNS validation is in flight', async () => {
    const repo = enabledRepo({ id: 'alice' });
    let release!: (addresses: ResolvedAddress[]) => void;
    const resolver = vi.fn(
      (): Promise<ResolvedAddress[]> => new Promise<ResolvedAddress[]>((resolve) => {
        release = resolve;
      }),
    );
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 200 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver,
      transport: { post },
      onResult: (result) => results.push(result),
    });

    dispatcher.enqueue('alice', payload(1));
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    repo.setEnabled('alice', false, 3, 0);
    release([{ address: '1.1.1.1', family: 4 }]);
    await dispatcher.whenIdle();

    expect(post).not.toHaveBeenCalled();
    expect(results).toEqual([{ kind: 'fills', outcome: 'failed', category: 'configuration' }]);
  });

  it('refuses a deleted owner at enqueue and after DNS validation begins', async () => {
    const repo = enabledRepo({ id: 'alice' }, { id: 'bob' });
    let aliceActive = true;
    let release!: (addresses: ResolvedAddress[]) => void;
    const resolver = vi.fn(
      (): Promise<ResolvedAddress[]> => new Promise<ResolvedAddress[]>((resolve) => {
        release = resolve;
      }),
    );
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 204 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver,
      transport: { post },
      isUserActive: (userId) => userId === 'bob' || aliceActive,
      onResult: (result) => results.push(result),
    });

    expect(dispatcher.enqueue('alice', payload(1))).toBe('queued');
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    aliceActive = false;
    release([{ address: '1.1.1.1', family: 4 }]);
    await dispatcher.whenIdle();

    expect(dispatcher.enqueue('alice', payload(2))).toBe('disabled');
    expect(post).not.toHaveBeenCalled();
    expect(results).toEqual([{ kind: 'fills', outcome: 'failed', category: 'configuration' }]);
  });

  it.each(['replace', 'clear and re-add'] as const)(
    'never delivers an old queued job after %s while DNS is in flight',
    async (mutation) => {
      const repo = enabledRepo({ id: 'alice', url: 'https://old.hooks.vendor.com/private' });
      let release!: (addresses: ResolvedAddress[]) => void;
      const resolver: WebhookResolver = () =>
        new Promise<ResolvedAddress[]>((resolve) => {
          release = resolve;
        });
      const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 204 });
      const results: unknown[] = [];
      const dispatcher = createUserWebhookDispatcher({
        repo,
        resolver,
        transport: { post },
        onResult: (result) => results.push(result),
      });

      dispatcher.enqueue('alice', payload(1));
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (mutation === 'clear and re-add') repo.remove('alice');
      repo.configure('alice', 'https://new.hooks.vendor.com/private', 3, 0);
      repo.setEnabled('alice', true, 4, 0);
      release([{ address: '1.1.1.1', family: 4 }]);
      await dispatcher.whenIdle();

      expect(post).not.toHaveBeenCalled();
      expect(results).toEqual([{ kind: 'fills', outcome: 'failed', category: 'configuration' }]);
      expect(repo.urlFor('alice')).toBe('https://new.hooks.vendor.com/private');
    },
  );

  it('drops an old-generation fill batch that was still waiting in the queue', async () => {
    const repo = enabledRepo(
      { id: 'blocker', url: 'https://blocker.hooks.vendor.com/incoming' },
      { id: 'alice', url: 'https://old.hooks.vendor.com/private' },
    );
    let release!: (addresses: ResolvedAddress[]) => void;
    const resolver = vi.fn(
      (): Promise<ResolvedAddress[]> => new Promise<ResolvedAddress[]>((resolve) => {
        release = resolve;
      }),
    );
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 204 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver,
      transport: { post },
      maxConcurrent: 1,
      maxPending: 2,
      onResult: (result) => results.push(result),
    });

    expect(dispatcher.enqueue('blocker', payload(1))).toBe('queued');
    expect(dispatcher.enqueue('alice', payload(2))).toBe('queued');
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    repo.configure('alice', 'https://new.hooks.vendor.com/private', 3, 0);
    repo.setEnabled('alice', true, 4, 0);
    release([{ address: '1.1.1.1', family: 4 }]);
    await dispatcher.whenIdle();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].hostname).toBe('blocker.hooks.vendor.com');
    expect(results).toEqual([
      { kind: 'fills', outcome: 'delivered', category: null },
      { kind: 'fills', outcome: 'failed', category: 'configuration' },
    ]);
    expect(repo.urlFor('alice')).toBe('https://new.hooks.vendor.com/private');
  });

  it('bounds global pending work and records a fixed queue-full outcome', async () => {
    const repo = enabledRepo({ id: 'alice' }, { id: 'bob' }, { id: 'carol' });
    let release!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const post = vi.fn<UserWebhookTransport['post']>()
      .mockImplementationOnce(async () => {
        await firstBlocked;
        return { statusCode: 204 };
      })
      .mockResolvedValue({ statusCode: 204 });
    const results: unknown[] = [];
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver: publicResolver,
      transport: { post },
      maxConcurrent: 1,
      maxPending: 2,
      onResult: (result) => results.push(result),
    });

    expect(dispatcher.enqueue('alice', payload(1))).toBe('queued');
    expect(dispatcher.enqueue('bob', payload(2))).toBe('queued');
    expect(dispatcher.enqueue('carol', payload(3))).toBe('full');
    expect(dispatcher.pending()).toBe(2);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(dispatcher.pending()).toBe(2);

    release();
    await dispatcher.whenIdle();

    expect(post).toHaveBeenCalledTimes(2);
    expect(dispatcher.pending()).toBe(0);
    expect(results).toContainEqual({ kind: 'fills', outcome: 'failed', category: 'queue-full' });
    expect(repo.metaFor('carol')?.lastDelivery).toMatchObject({
      outcome: 'failed',
      failureCategory: 'queue-full',
    });
  });

  it('isolates a throwing transport and result hook from later queued deliveries', async () => {
    const repo = enabledRepo({ id: 'alice' }, { id: 'bob' });
    const post = vi.fn<UserWebhookTransport['post']>()
      .mockRejectedValueOnce(new Error('first delivery failed'))
      .mockResolvedValueOnce({ statusCode: 204 });
    const dispatcher = createUserWebhookDispatcher({
      repo,
      resolver: publicResolver,
      transport: { post },
      maxConcurrent: 1,
      onResult: () => {
        throw new Error('metrics sink failed');
      },
    });

    dispatcher.enqueue('alice', payload(1));
    dispatcher.enqueue('bob', payload(2));
    await expect(dispatcher.whenIdle()).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledTimes(2);
    expect(repo.metaFor('alice')?.lastDelivery).toMatchObject({ outcome: 'failed', failureCategory: 'network' });
    expect(repo.metaFor('bob')?.lastDelivery).toMatchObject({ outcome: 'delivered', failureCategory: null });
  });

  it('does not enqueue or contact anything for an unconfigured or disabled user', async () => {
    const repo = new UserWebhookRepo(KMS);
    repo.configure('disabled', 'https://disabled.hooks.vendor.com/x', 1, 0);
    const post = vi.fn<UserWebhookTransport['post']>().mockResolvedValue({ statusCode: 204 });
    const dispatcher = createUserWebhookDispatcher({ repo, resolver: publicResolver, transport: { post } });

    expect(dispatcher.enqueue('missing', payload(1))).toBe('disabled');
    expect(dispatcher.enqueue('disabled', payload(2))).toBe('disabled');
    await dispatcher.whenIdle();

    expect(post).not.toHaveBeenCalled();
  });
});

describe('pinned HTTPS transport input bound', () => {
  it('rejects an oversized body before opening a network request', async () => {
    const transport = new PinnedHttpsWebhookTransport();
    await expect(
      transport.post(
        {
          url: new URL('https://hooks.vendor.com/incoming'),
          hostname: 'hooks.vendor.com',
          address: '1.1.1.1',
          family: 4,
        },
        'x'.repeat(MAX_USER_WEBHOOK_PAYLOAD_BYTES + 1),
        'delivery-safe-id',
      ),
    ).rejects.toMatchObject({ category: 'malformed-response' });
  });

  it('enforces an absolute deadline and destroys a never-finishing request', async () => {
    vi.useFakeTimers();
    try {
      let onError = () => {};
      const destroy = vi.fn(() => onError());
      const requestFactory: UserWebhookRequestFactory = () => ({
        once: (_event, listener) => {
          onError = listener;
        },
        destroy,
        end: vi.fn(),
      });
      const transport = new PinnedHttpsWebhookTransport(requestFactory, 50);
      const result = expect(
        transport.post(
          {
            url: new URL('https://hooks.vendor.com/incoming'),
            hostname: 'hooks.vendor.com',
            address: '1.1.1.1',
            family: 4,
          },
          '{}',
          'delivery-safe-id',
        ),
      ).rejects.toMatchObject({ category: 'timeout' });

      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes a response without a numeric status', async () => {
    const responseDestroy = vi.fn();
    const requestFactory: UserWebhookRequestFactory = (_options, onResponse) => ({
      once: () => {},
      destroy: vi.fn(),
      end: () => queueMicrotask(() => onResponse({ destroy: responseDestroy })),
    });
    const transport = new PinnedHttpsWebhookTransport(requestFactory, 50);

    await expect(
      transport.post(
        {
          url: new URL('https://hooks.vendor.com/incoming'),
          hostname: 'hooks.vendor.com',
          address: '1.1.1.1',
          family: 4,
        },
        '{}',
        'delivery-safe-id',
      ),
    ).rejects.toMatchObject({ category: 'malformed-response' });
    expect(responseDestroy).toHaveBeenCalledTimes(1);
  });
});
