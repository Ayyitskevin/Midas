import { describe, it, expect } from 'vitest';
import { honestLiquidationsMeta } from './liquidationsHonesty';
import { createProvider } from './providers/index';

describe('honestLiquidationsMeta', () => {
  it('forces synthetic+note for mock provenance', () => {
    const meta = honestLiquidationsMeta(
      { source: 'mock', available: true, synthetic: true, note: 'demo note' },
      1_700_000_000_000,
    );
    expect(meta.synthetic).toBe(true);
    expect(meta.note).toMatch(/demo|synthetic/i);
    expect(meta.asOf).toBe(1_700_000_000_000);
  });

  it('repairs mock source that forgot synthetic flag', () => {
    const meta = honestLiquidationsMeta({ source: 'mock', available: true });
    expect(meta.synthetic).toBe(true);
    expect(meta.note?.length).toBeGreaterThan(0);
  });

  it('leaves live ccxt available feeds non-synthetic', () => {
    const meta = honestLiquidationsMeta({
      source: 'ccxt:okx',
      available: true,
      synthetic: false,
      note: 'throttled',
    });
    expect(meta.synthetic).toBe(false);
    expect(meta.note).toBe('throttled');
  });
});

describe('provider liquidations provenance honesty', () => {
  it('mock provider is synthetic and never live-eligible after normalize', () => {
    const raw = createProvider('mock').liquidationsProvenance();
    expect(raw.synthetic).toBe(true);
    const meta = honestLiquidationsMeta(raw);
    expect(meta.synthetic).toBe(true);
    expect(meta.source).toBe('mock');
  });
});
