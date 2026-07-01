import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { decryptText, encryptText } from './crypto';
import { KeyRepo } from './repo';
import { createProviderPool } from './pool';
import { buildApp } from '../app';
import { createProvider, type DataProvider } from '../providers';

const KMS = 'test-kms-secret';

describe('keys crypto', () => {
  it('round-trips and produces distinct ciphertexts per call (random IV)', () => {
    const a = encryptText('s3cret', KMS);
    const b = encryptText('s3cret', KMS);
    expect(a).not.toBe(b);
    expect(decryptText(a, KMS)).toBe('s3cret');
    expect(decryptText(b, KMS)).toBe('s3cret');
  });

  it('fails closed on tampering, truncation and a wrong KMS secret', () => {
    const enc = encryptText('s3cret', KMS);
    expect(decryptText(enc, 'other-secret')).toBeNull();
    expect(decryptText(enc.slice(0, -2), KMS)).toBeNull();
    const [iv, tag, data] = enc.split('.');
    const flipped = data[0] === 'A' ? 'B' + data.slice(1) : 'A' + data.slice(1);
    expect(decryptText(`${iv}.${tag}.${flipped}`, KMS)).toBeNull();
    expect(decryptText('garbage', KMS)).toBeNull();
  });
});

describe('KeyRepo', () => {
  const sample = { exchange: 'Binance', apiKey: 'AKIA1234SECRETKEY9999', secret: 'sss', canTrade: false };

  it('stores encrypted, returns decrypted, exposes only metadata', () => {
    const repo = new KeyRepo(KMS);
    const meta = repo.set('u1', sample, 42);
    expect(meta).toEqual({ exchange: 'binance', keyLast4: '9999', canTrade: false, createdAt: 42 });
    expect(repo.get('u1')).toEqual({ exchange: 'binance', apiKey: sample.apiKey, secret: 'sss', canTrade: false });
    expect(repo.get('u2')).toBeNull();
    expect(repo.remove('u1')).toBe(true);
    expect(repo.get('u1')).toBeNull();
  });

  it('never writes plaintext secrets to disk, and survives a reload', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'midas-keys-')), 'user-keys.json');
    const repo = new KeyRepo(KMS, file);
    repo.set('u1', { ...sample, password: 'passphrase' }, 1);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(sample.apiKey);
    expect(raw).not.toContain('sss');
    expect(raw).not.toContain('passphrase');
    const reloaded = new KeyRepo(KMS, file);
    expect(reloaded.get('u1')?.apiKey).toBe(sample.apiKey);
    expect(reloaded.get('u1')?.password).toBe('passphrase');
    // Wrong KMS secret → fails closed rather than yielding garbage creds.
    expect(new KeyRepo('wrong', file).get('u1')).toBeNull();
  });
});

describe('provider pool', () => {
  const base = { name: 'base' } as unknown as DataProvider;
  const repo = new KeyRepo(KMS);
  repo.set('alice', { exchange: 'binance', apiKey: 'aaaa', secret: 's', canTrade: false }, 0);
  repo.set('bob', { exchange: 'kraken', apiKey: 'bbbb', secret: 's', canTrade: false }, 0);

  it('resolves per user with caching and strict isolation, base for everyone else', () => {
    let built = 0;
    const pool = createProviderPool({
      base,
      repo,
      factory: (k) => {
        built += 1;
        return { name: `user:${k.exchange}` } as unknown as DataProvider;
      },
    });
    expect(pool.for(undefined)).toBe(base);
    expect(pool.for('nobody')).toBe(base);
    const a1 = pool.for('alice');
    const a2 = pool.for('alice');
    const b = pool.for('bob');
    expect(a1.name).toBe('user:binance');
    expect(b.name).toBe('user:kraken');
    expect(a1).toBe(a2); // cached
    expect(built).toBe(2);
    pool.invalidate('alice');
    pool.for('alice');
    expect(built).toBe(3); // rebuilt after key change
  });

  it('falls back to base when the factory cannot construct (bad exchange id)', () => {
    const pool = createProviderPool({
      base,
      repo,
      factory: () => {
        throw new Error('unknown exchange');
      },
    });
    expect(pool.for('alice')).toBe(base);
  });
});

describe('key routes', () => {
  let app: FastifyInstance;
  let token = '';

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      keyRepo: new KeyRepo(KMS),
    });
    await app.ready();
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'keyuser', password: 'correct-horse' },
    });
    token = signup.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('PUT stores keys and answers with metadata only — the secret never comes back', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/keys',
      headers: auth(),
      payload: { exchange: 'binance', apiKey: 'AKIAKEY12345678', secret: 'supersecret', canTrade: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ exchange: 'binance', keyLast4: '5678', canTrade: true, createdAt: expect.any(Number) });
    expect(res.body).not.toContain('supersecret');

    const meta = await app.inject({ method: 'GET', url: '/api/account/keys', headers: auth() });
    expect(meta.json().keys.keyLast4).toBe('5678');
    expect(meta.body).not.toContain('supersecret');

    const del = await app.inject({ method: 'DELETE', url: '/api/account/keys', headers: auth() });
    expect(del.json().ok).toBe(true);
    const after = await app.inject({ method: 'GET', url: '/api/account/keys', headers: auth() });
    expect(after.json().keys).toBeNull();
  });

  it('rejects junk and requires auth', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/account/keys',
      headers: auth(),
      payload: { exchange: 'binance' },
    });
    expect(bad.statusCode).toBe(400);
    const anon = await app.inject({ method: 'GET', url: '/api/account/keys' });
    expect(anon.statusCode).toBe(401); // the auth guard answers first
  });

  it('is honestly off without a KMS secret', async () => {
    const off = await buildApp(createProvider('mock'), {
      auth: { enabled: true, allowSignup: true, secret: 'test-secret' },
      keyRepo: null,
    });
    await off.ready();
    const s = await off.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'x', password: 'correct-horse' },
    });
    const res = await off.inject({
      method: 'GET',
      url: '/api/account/keys',
      headers: { authorization: `Bearer ${s.json().token}` },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().message).toMatch(/MIDAS_KEYS_KMS_SECRET/);
    await off.close();
  });
});
