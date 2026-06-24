import { describe, it, expect } from 'vitest';
import { authToken } from '@/lib/authToken';

describe('authToken', () => {
  it('stores and clears the current token', () => {
    authToken.set('abc');
    expect(authToken.get()).toBe('abc');
    authToken.set(null);
    expect(authToken.get()).toBeNull();
  });

  it('fires the registered unauthorized handler', () => {
    let fired = 0;
    authToken.setOnUnauthorized(() => {
      fired += 1;
    });
    authToken.fireUnauthorized();
    expect(fired).toBe(1);
  });
});
