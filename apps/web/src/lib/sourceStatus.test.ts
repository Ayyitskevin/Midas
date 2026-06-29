import { describe, it, expect } from 'vitest';
import { sourceView, demoBanner } from './sourceStatus';

describe('sourceView', () => {
  it('labels a live provider green with an honest tooltip', () => {
    const v = sourceView('ccxt:binance', true);
    expect(v.tone).toBe('live');
    expect(v.label).toBe('ccxt:binance');
    expect(v.dotClass).toBe('text-term-up');
    expect(v.title).toMatch(/live/i);
  });

  it('flags a synthetic/mock provider amber and says it is not real', () => {
    const v = sourceView('mock', false);
    expect(v.tone).toBe('synthetic');
    expect(v.dotClass).toBe('text-term-amber');
    expect(v.title).toMatch(/not real market data/i);
  });
});

describe('demoBanner', () => {
  it('returns null for any live provider (never shows over real data)', () => {
    expect(demoBanner('ccxt:binance', true)).toBeNull();
    expect(demoBanner('yahoo', true)).toBeNull();
  });

  it('shows a synthetic-data banner naming the provider when not live', () => {
    const b = demoBanner('mock', false);
    expect(b).not.toBeNull();
    expect(b!.text).toMatch(/synthetic/i);
    expect(b!.text).toContain('mock');
    expect(b!.hint).toMatch(/ccxt/);
  });
});
