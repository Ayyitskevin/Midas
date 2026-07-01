import { describe, it, expect } from 'vitest';
import { applyDemoMode, config, type Config } from './config';

describe('applyDemoMode', () => {
  const risky: Config = {
    ...config,
    demoMode: true,
    provider: 'ccxt',
    tradingEnabled: true,
    tradingAllowNoAuth: true,
    authAllowSignup: true,
  };

  it('forces the safe public-demo posture no matter what the env says', () => {
    const safe = applyDemoMode(risky);
    expect(safe.provider).toBe('mock');
    expect(safe.tradingEnabled).toBe(false);
    expect(safe.tradingAllowNoAuth).toBe(false);
    expect(safe.authAllowSignup).toBe(false);
  });

  it('is a no-op when demo mode is off', () => {
    const cfg = { ...risky, demoMode: false };
    expect(applyDemoMode(cfg)).toEqual(cfg);
  });
});
