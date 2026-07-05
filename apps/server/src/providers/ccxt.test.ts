import { describe, it, expect } from 'vitest';
import { safeErrorLabel } from './ccxt';
import { ProviderError } from './types';

// safeErrorLabel is the single sanitizer every ccxt read-error path routes
// through — the thrown ProviderError message on market reads and the `note`
// field of balances/openOrders/positions/fills 'unavailable' snapshots. A ccxt
// error can carry the signed request URL (HMAC signature, API key) and the raw
// response body; none of that may reach a client, so this must never surface the
// raw message.
describe('safeErrorLabel', () => {
  it('returns the error class name, never the raw message', () => {
    // A realistic ccxt error: the message embeds the signed request URL.
    const leak = new Error(
      'GET https://api.binance.com/api/v3/account?timestamp=1&signature=deadbeefcafe 401 Unauthorized {"code":-2015,"msg":"Invalid API-key"}',
    );
    leak.name = 'AuthenticationError';
    const label = safeErrorLabel(leak);
    expect(label).toBe('AuthenticationError');
    expect(label).not.toContain('signature=');
    expect(label).not.toContain('api.binance.com');
    expect(label).not.toContain('Invalid API-key');
  });

  it('preserves an explicit ProviderError message (ours, already safe)', () => {
    expect(safeErrorLabel(new ProviderError('Unsupported symbol', 400))).toBe('Unsupported symbol');
  });

  it('falls back to a generic label for a nameless or non-Error value', () => {
    const anon = new Error('secret detail');
    anon.name = '';
    expect(safeErrorLabel(anon)).toBe('error');
    expect(safeErrorLabel('signature=deadbeef')).toBe('error');
    expect(safeErrorLabel(null)).toBe('error');
  });
});
