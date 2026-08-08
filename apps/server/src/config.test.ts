import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  applyDemoMode,
  authAllowSignupEnv,
  config,
  dataProviderEnv,
  numEnv,
  userWebhooksEnv,
  type Config,
} from './config';
import { createProvider } from './providers';

describe('numEnv', () => {
  const KEY = 'MIDAS_TEST_NUM_ENV';
  afterEach(() => {
    delete process.env[KEY];
    vi.restoreAllMocks();
  });

  it('parses valid values, including an explicit 0', () => {
    process.env[KEY] = '250';
    expect(numEnv(KEY, 7)).toBe(250);
    process.env[KEY] = '0';
    expect(numEnv(KEY, 7)).toBe(0);
  });

  it('falls back when unset or empty', () => {
    expect(numEnv(KEY, 7)).toBe(7);
    process.env[KEY] = '';
    expect(numEnv(KEY, 7)).toBe(7);
  });

  it('fails SAFE on garbage — a cap typo must never mean "uncapped"', () => {
    // `Number('1o00')` is NaN, and `notional > NaN` is always false: without
    // the guard this would silently disable MIDAS_MAX_ORDER_USD.
    for (const bad of ['1o00', 'abc', '-5', 'Infinity', 'NaN']) {
      process.env[KEY] = bad;
      expect(numEnv(KEY, 1000)).toBe(1000);
    }
  });

  it('does not copy a hostile environment value into its warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[KEY] = 'apiKey=LEAK_KEY /home/private/config';
    expect(numEnv(KEY, 1000)).toBe(1000);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain(KEY);
    expect(logged).not.toMatch(/LEAK_KEY|\/home\/private|apiKey=/);
  });
});

describe('authAllowSignupEnv', () => {
  const KEY = 'MIDAS_AUTH_ALLOW_SIGNUP';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('defaults ongoing registration closed and requires an explicit opt-in', () => {
    delete process.env[KEY];
    expect(authAllowSignupEnv()).toBe(false);
    process.env[KEY] = 'true';
    expect(authAllowSignupEnv()).toBe(true);
  });
});

describe('dataProviderEnv', () => {
  const KEY = 'MIDAS_DATA_PROVIDER';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('never falls back to mock when provider selection is absent', () => {
    delete process.env[KEY];
    expect(dataProviderEnv()).toBe('');
    expect(() => createProvider(dataProviderEnv())).toThrow(/Unknown data provider/);
  });

  it('accepts an explicit mock selection', () => {
    process.env[KEY] = '  MOCK  ';
    expect(dataProviderEnv()).toBe('mock');
    expect(createProvider(dataProviderEnv()).live).toBe(false);
  });
});

describe('userWebhooksEnv', () => {
  const KEY = 'MIDAS_USER_WEBHOOKS';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('is disabled by default and requires an explicit true value', () => {
    delete process.env[KEY];
    expect(userWebhooksEnv()).toBe(false);
    process.env[KEY] = 'true';
    expect(userWebhooksEnv()).toBe(true);
    process.env[KEY] = '1';
    expect(userWebhooksEnv()).toBe(false);
  });
});

describe('applyDemoMode', () => {
  const risky: Config = {
    ...config,
    demoMode: true,
    provider: 'ccxt',
    tradingEnabled: true,
    tradingAllowNoAuth: true,
    authAllowSignup: true,
    userWebhooksEnabled: true,
  };

  it('forces the safe public-demo posture no matter what the env says', () => {
    const safe = applyDemoMode(risky);
    expect(safe.provider).toBe('mock');
    expect(safe.tradingEnabled).toBe(false);
    expect(safe.tradingAllowNoAuth).toBe(false);
    expect(safe.authAllowSignup).toBe(false);
    expect(safe.userWebhooksEnabled).toBe(false);
  });

  it('is a no-op when demo mode is off', () => {
    const cfg = { ...risky, demoMode: false };
    expect(applyDemoMode(cfg)).toEqual(cfg);
  });
});
