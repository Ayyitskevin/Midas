import { describe, it, expect } from 'vitest';
import { gtData, parsePairName, num, str } from './gecko';

describe('parsePairName', () => {
  it('splits base / quote and reads the fee tier as bps', () => {
    expect(parsePairName('WIF / SOL 0.25%')).toEqual({ base: 'WIF', quote: 'SOL', feeBps: 25 });
  });

  it('uppercases both sides and defaults a missing quote to "?"', () => {
    expect(parsePairName('bonk')).toEqual({ base: 'BONK', quote: '?', feeBps: null });
  });

  it('is defensive: empty name → empty base, no fee', () => {
    expect(parsePairName('')).toEqual({ base: '', quote: '?', feeBps: null });
  });

  it('nulls a non-finite fee rather than emitting NaN', () => {
    const p = parsePairName('A / B x%');
    expect(p.feeBps).toBeNull();
  });
});

describe('gtData', () => {
  it('extracts the data array', () => {
    expect(gtData({ data: [{ attributes: {} }, { attributes: {} }] })).toHaveLength(2);
  });

  it('returns [] for malformed payloads (null, missing/!array data)', () => {
    expect(gtData(null)).toEqual([]);
    expect(gtData({})).toEqual([]);
    expect(gtData({ data: 'nope' })).toEqual([]);
  });
});

describe('num / str', () => {
  it('coerce defensively', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num(7)).toBe(7);
    expect(num('nope')).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(str('x')).toBe('x');
    expect(str(3)).toBe('');
  });
});
