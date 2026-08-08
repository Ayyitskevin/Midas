import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserWebhookRepo, UserWebhookStoreError } from './repo';
import { resolveWebhookTarget, WebhookUrlError, type WebhookResolver } from './url';
import { completedDigestWindow } from './cadence';

const KMS = 'test-user-webhook-kms-secret';
const publicDns: WebhookResolver = async () => [{ address: '1.1.1.1', family: 4 }];

describe('personal webhook URL boundary', () => {
  it('accepts only a canonical public HTTPS target', async () => {
    const target = await resolveWebhookTarget(' https://Hooks.Vendor.com/path?token=opaque ', publicDns);
    expect(target.url.toString()).toBe('https://hooks.vendor.com/path?token=opaque');
    expect(target.hostname).toBe('hooks.vendor.com');
    expect(target.address).toBe('1.1.1.1');
  });

  it('rejects Unicode input that expands beyond the canonical byte bound', async () => {
    const raw = `https://hooks.vendor.com/${'é'.repeat(2_000)}`;
    expect(raw.length).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(new URL(raw).toString())).toBeGreaterThan(2_048);
    await expect(resolveWebhookTarget(raw, publicDns)).rejects.toMatchObject({ category: 'invalid' });
  });

  it.each([
    'http://hooks.vendor.com/x',
    'ftp://hooks.vendor.com/x',
    'https://user:pass@hooks.vendor.com/x',
    'https://hooks.vendor.com:8443/x',
    'https://hooks.vendor.com/x#fragment',
    'not a URL',
    '',
  ])('rejects malformed, credential-bearing, or unsupported URLs: %s', async (url) => {
    await expect(resolveWebhookTarget(url, publicDns)).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it.each([
    'https://localhost/x',
    'https://service.internal/x',
    'https://metadata.google.internal/x',
    'https://127.0.0.1/x',
    'https://127.1/x',
    'https://2130706433/x',
    'https://10.1.2.3/x',
    'https://169.254.169.254/latest/meta-data',
    'https://100.100.100.200/latest/meta-data',
    'https://192.168.1.1/x',
    'https://[::1]/x',
    'https://[fe80::1]/x',
    'https://[fc00::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://[::127.0.0.1]/x',
    'https://[2002:7f00:1::]/x',
    'https://[fec0::1]/x',
    'https://[4000::1]/x',
    'https://[3fff::1]/x',
  ])('rejects local, private, link-local, metadata, and mapped targets: %s', async (url) => {
    await expect(resolveWebhookTarget(url, publicDns)).rejects.toMatchObject({ category: 'blocked-target' });
  });

  it('rejects a hostname when any DNS answer is private (mixed-answer rebinding defense)', async () => {
    const mixed: WebhookResolver = async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ];
    await expect(resolveWebhookTarget('https://hooks.vendor.com/x', mixed)).rejects.toMatchObject({
      category: 'blocked-target',
    });
  });

  it('turns resolver failures and empty answers into a fixed DNS category', async () => {
    await expect(
      resolveWebhookTarget('https://hooks.vendor.com/x', async () => {
        throw new Error('lookup leaked internal details');
      }),
    ).rejects.toMatchObject({ category: 'dns', message: 'Webhook hostname could not be resolved.' });
    await expect(resolveWebhookTarget('https://hooks.vendor.com/x', async () => [])).rejects.toMatchObject({
      category: 'dns',
    });
  });

  it('accepts public literal IPv4 and IPv6 without DNS', async () => {
    const never: WebhookResolver = async () => {
      throw new Error('must not resolve a literal');
    };
    await expect(resolveWebhookTarget('https://8.8.8.8/hook', never)).resolves.toMatchObject({
      address: '8.8.8.8',
      family: 4,
    });
    await expect(resolveWebhookTarget('https://[2606:4700:4700::1111]/hook', never)).resolves.toMatchObject({
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });
});

describe('UserWebhookRepo', () => {
  it('encrypts the URL at rest, returns metadata only, and starts disabled', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    const repo = new UserWebhookRepo(KMS, file);
    const url = 'https://hooks.vendor.com/SECRET-TOKEN';
    const meta = repo.configure('alice', url, 100, 50);
    expect(meta).toEqual({ enabled: false, createdAt: 100, updatedAt: 100, lastDelivery: null });
    expect(JSON.stringify(meta)).not.toMatch(/hooks\.vendor|SECRET-TOKEN/);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('hooks.vendor.com');
    expect(raw).not.toContain('SECRET-TOKEN');
    expect(new UserWebhookRepo(KMS, file).urlFor('alice')).toBe(url);
    expect(new UserWebhookRepo('wrong-secret', file).urlFor('alice')).toBeNull();
  });

  it('replacement stays disabled and never backfills an already-completed window', () => {
    const repo = new UserWebhookRepo(KMS);
    repo.configure('alice', 'https://hooks.vendor.com/one', 100, 1_000);
    repo.setEnabled('alice', true, 110, 1_000);
    expect(repo.enabled('alice')).toBe(true);
    repo.configure('alice', 'https://hooks.vendor.com/two', 120, 1_000);
    expect(repo.metaFor('alice')?.enabled).toBe(false);
    repo.setEnabled('alice', true, 130, 1_000);
    expect(repo.claimDigest('alice', 1_000, 'same-window', 140)).toBe(false);
    expect(repo.claimDigest('alice', 2_000, 'next-window', 150)).toBe(true);
  });

  it('cannot persist an expanded URL that would make the next reload fail', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    const repo = new UserWebhookRepo(KMS, file);
    const validUrl = 'https://hooks.vendor.com/valid';
    repo.configure('alice', validUrl, 1, 0);
    const before = readFileSync(file, 'utf8');
    const expanded = new URL(`https://hooks.vendor.com/${'é'.repeat(2_000)}`).toString();

    expect(() => repo.configure('bob', expanded, 2, 0)).toThrow(UserWebhookStoreError);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const reloaded = new UserWebhookRepo(KMS, file);
    expect(reloaded.urlFor('alice')).toBe(validUrl);
    expect(reloaded.metaFor('bob')).toBeNull();
  });

  it('cryptographically binds each ciphertext to its authenticated owner', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    const repo = new UserWebhookRepo(KMS, file);
    repo.configure('alice', 'https://alice.vendor.com/secret-a', 1, 0);
    repo.configure('bob', 'https://bob.vendor.com/secret-b', 1, 0);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      records: Record<string, { urlEnc: string }>;
    };
    const alice = stored.records.alice.urlEnc;
    stored.records.alice.urlEnc = stored.records.bob.urlEnc;
    stored.records.bob.urlEnc = alice;
    writeFileSync(file, JSON.stringify(stored));

    const reloaded = new UserWebhookRepo(KMS, file);
    expect(reloaded.urlFor('alice')).toBeNull();
    expect(reloaded.urlFor('bob')).toBeNull();
  });

  it('persists claim-before-send so restart cannot duplicate a digest window', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    const repo = new UserWebhookRepo(KMS, file);
    repo.configure('alice', 'https://hooks.vendor.com/x', 1, 0);
    repo.setEnabled('alice', true, 2, 0);
    expect(repo.claimDigest('alice', 86_400_000, 'digest-1', 3)).toBe(true);
    expect(repo.metaFor('alice')?.lastDelivery).toMatchObject({ kind: 'digest', outcome: 'pending' });

    const restarted = new UserWebhookRepo(KMS, file);
    expect(restarted.claimDigest('alice', 86_400_000, 'digest-duplicate', 4)).toBe(false);
    expect(restarted.metaFor('alice')?.lastDelivery).toMatchObject({ kind: 'digest', outcome: 'pending' });
    expect(restarted.claimDigest('alice', 2 * 86_400_000, 'digest-2', 5)).toBe(true);
  });

  it('refuses non-finite cadence claims without corrupting durable state', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    const repo = new UserWebhookRepo(KMS, file);
    repo.configure('alice', 'https://hooks.vendor.com/x', 1, 0);
    repo.setEnabled('alice', true, 2, 0);

    expect(completedDigestWindow(1_000, 1e308)).toBeNull();
    expect(repo.claimDigest('alice', Number.POSITIVE_INFINITY, 'bad-window', 3)).toBe(false);
    expect(repo.claimDigest('alice', 1_000, 'x'.repeat(129), 3)).toBe(false);
    expect(() => new UserWebhookRepo(KMS, file)).not.toThrow();
    expect(new UserWebhookRepo(KMS, file).metaFor('alice')?.enabled).toBe(true);
  });

  it('fails closed on corrupt or unversioned durable state', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-user-webhook-')), 'webhooks.json');
    writeFileSync(file, '{"records":{"alice":{"urlEnc":"plaintext"}}}');
    let failure: unknown;
    try {
      new UserWebhookRepo(KMS, file);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(UserWebhookStoreError);
    expect((failure as Error).message).not.toContain('plaintext');
  });
});
