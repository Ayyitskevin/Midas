import { describe, it, expect } from 'vitest';
import { classifyKeysError, maskKey, validateKeysInput } from './keysView';

describe('classifyKeysError', () => {
  it('maps the server answers onto the honest panel states', () => {
    // 501 body when the operator has not enabled the store.
    expect(
      classifyKeysError(
        'Per-user exchange keys are not enabled on this server — the operator must set MIDAS_KEYS_KMS_SECRET…',
      ),
    ).toBe('feature-off');
    // 400 from the key routes / 401 from the auth guard.
    expect(classifyKeysError('Per-user keys require login — enable MIDAS_AUTH_ENABLED and sign in first.')).toBe(
      'needs-auth',
    );
    expect(classifyKeysError('Unauthorized')).toBe('needs-auth');
    // Anything else is an honest plain error.
    expect(classifyKeysError('fetch failed')).toBe('error');
  });
});

describe('validateKeysInput', () => {
  const ok = { exchange: 'binance', apiKey: 'AKIA123', secret: 'sss', canTrade: false };

  it('accepts a complete input and rejects missing fields with readable reasons', () => {
    expect(validateKeysInput(ok)).toEqual([]);
    expect(validateKeysInput({ ...ok, exchange: ' ' })).toEqual([
      'Exchange id is required (e.g. binance, kraken).',
    ]);
    expect(validateKeysInput({ ...ok, apiKey: '' })).toEqual(['API key is required.']);
    expect(validateKeysInput({ ...ok, secret: '' })).toEqual(['API secret is required.']);
  });

  it('insists on a ccxt-shaped exchange id', () => {
    expect(validateKeysInput({ ...ok, exchange: 'Binance US!' })[0]).toMatch(/ccxt id/);
    expect(validateKeysInput({ ...ok, exchange: 'coinbasepro' })).toEqual([]);
  });
});

describe('maskKey', () => {
  it('shows only the stored last 4', () => {
    expect(maskKey('5678')).toBe('••••••••5678');
  });
});
