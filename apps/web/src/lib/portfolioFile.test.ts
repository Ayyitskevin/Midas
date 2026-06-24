import { describe, it, expect } from 'vitest';
import { buildPortfolioExport, parsePortfolioExport, parsePortfolioSnapshot } from '@/lib/portfolioFile';

describe('parsePortfolioExport', () => {
  it('round-trips a built export', () => {
    const exp = buildPortfolioExport(
      42,
      [{ id: 'p1', symbol: 'BTC/USDT', quantity: 2, entryPrice: 100, openedAt: 5 }],
      [{ id: 't1', symbol: 'BTC/USDT', quantity: 2, price: 100, realized: 0, at: 5 }],
    );
    const parsed = parsePortfolioExport(exp);
    expect(parsed.realized).toBe(42);
    expect(parsed.positions).toHaveLength(1);
    expect(parsed.positions[0].symbol).toBe('BTC/USDT');
    expect(parsed.positions[0].quantity).toBe(2);
    expect(parsed.transactions).toHaveLength(1);
  });

  it('rejects non-objects and the wrong magic marker', () => {
    expect(() => parsePortfolioExport(null)).toThrow();
    expect(() => parsePortfolioExport('nope')).toThrow();
    expect(() => parsePortfolioExport({ midas: 'workspace', positions: [] })).toThrow(/Midas portfolio/);
  });

  it('rejects an empty book', () => {
    expect(() => parsePortfolioExport({ midas: 'portfolio', positions: [], transactions: [] })).toThrow();
  });

  it('drops malformed positions but keeps valid ones', () => {
    const parsed = parsePortfolioExport({
      midas: 'portfolio',
      realized: 0,
      positions: [
        { symbol: 'BTC/USDT', quantity: 1, entryPrice: 100 }, // ok
        { symbol: 'X', quantity: 0, entryPrice: 100 }, // qty 0 → dropped
        { symbol: 'Y', quantity: 1, entryPrice: -5 }, // bad price → dropped
        { quantity: 1, entryPrice: 1 }, // no symbol → dropped
        'garbage', // not an object → dropped
      ],
      transactions: [],
    });
    expect(parsed.positions).toHaveLength(1);
    expect(parsed.positions[0].symbol).toBe('BTC/USDT');
  });

  it('uppercases symbols and defaults realized to 0', () => {
    const parsed = parsePortfolioExport({
      midas: 'portfolio',
      positions: [{ symbol: 'eth/usdt', quantity: -1, entryPrice: 50 }],
      transactions: [],
    });
    expect(parsed.positions[0].symbol).toBe('ETH/USDT');
    expect(parsed.realized).toBe(0);
  });
});

describe('parsePortfolioSnapshot', () => {
  it('coerces a server blob without requiring a magic marker', () => {
    const snap = parsePortfolioSnapshot({
      realized: 12.5,
      positions: [{ symbol: 'btc/usdt', quantity: 2, entryPrice: 100, openedAt: 1 }],
      transactions: [{ symbol: 'BTC/USDT', quantity: 2, price: 100, realized: 0, at: 1 }],
    });
    expect(snap).not.toBeNull();
    expect(snap!.realized).toBe(12.5);
    expect(snap!.positions[0].symbol).toBe('BTC/USDT');
    expect(snap!.transactions).toHaveLength(1);
  });

  it('accepts an empty book (a cleared portfolio is still valid)', () => {
    const snap = parsePortfolioSnapshot({ realized: 0, positions: [], transactions: [] });
    expect(snap).toEqual({ realized: 0, positions: [], transactions: [] });
  });

  it('returns null for non-objects and drops malformed rows', () => {
    expect(parsePortfolioSnapshot(null)).toBeNull();
    expect(parsePortfolioSnapshot('nope')).toBeNull();
    const snap = parsePortfolioSnapshot({
      positions: [
        { symbol: 'BTC/USDT', quantity: 1, entryPrice: 100 },
        { symbol: 'X', quantity: 0, entryPrice: 1 }, // qty 0 → dropped
      ],
    });
    expect(snap!.positions).toHaveLength(1);
    expect(snap!.realized).toBe(0); // missing realized → 0
  });
});
