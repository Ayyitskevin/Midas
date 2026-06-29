import { describe, it, expect } from 'vitest';
import { sourceView } from './sourceStatus';

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
