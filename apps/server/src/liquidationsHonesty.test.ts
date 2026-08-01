import { describe, it, expect } from 'vitest';
import { normalizeLiquidationsMeta } from './liquidationsHonesty';

describe('normalizeLiquidationsMeta', () => {
  it('forces synthetic+note for mock provenance', () => {
    const meta = normalizeLiquidationsMeta(
      { source: 'mock', available: true, synthetic: true, note: 'demo note' },
      1_700_000_000_000,
    );
    expect(meta.synthetic).toBe(true);
    expect(meta.note).toMatch(/demo|synthetic/i);
    expect(meta.asOf).toBe(1_700_000_000_000);
  });

  it('repairs mock source that forgot synthetic flag', () => {
    const meta = normalizeLiquidationsMeta({ source: 'mock', available: true });
    expect(meta.synthetic).toBe(true);
    expect(meta.note?.length).toBeGreaterThan(0);
  });

  it('leaves live ccxt available feeds non-synthetic', () => {
    const meta = normalizeLiquidationsMeta({
      source: 'ccxt:okx',
      available: true,
      synthetic: false,
      note: 'throttled',
    });
    expect(meta.synthetic).toBe(false);
    expect(meta.note).toBe('throttled');
  });

  it('keeps unavailable feeds non-synthetic and supplies a no-feed note', () => {
    const meta = normalizeLiquidationsMeta({
      source: 'yahoo',
      available: false,
    });
    expect(meta.synthetic).toBe(false);
    expect(meta.note).toMatch(/no public liquidation feed/i);
  });
});
