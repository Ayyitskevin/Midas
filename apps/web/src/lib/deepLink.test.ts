import { describe, it, expect } from 'vitest';
import { encodeScan, encodeBoard, decodeLink, shareUrl } from './deepLink';
import { ANY_CRITERIA, type ScanCriteria } from './signals';

const crit = (over: Partial<ScanCriteria> = {}): ScanCriteria => ({ ...ANY_CRITERIA, ...over });

describe('encodeScan / decodeLink (scan)', () => {
  it('round-trips a compound criteria set, omitting "any"/null fields', () => {
    const c = crit({ trend: 'up', rsi: 'oversold', minScore: 1 });
    const token = encodeScan(c);
    expect(token).toBe('scan?t=up&r=oversold&s=1');
    const decoded = decodeLink(token);
    expect(decoded).toEqual({ kind: 'scan', criteria: c });
  });

  it('encodes the empty (ANY) scan and round-trips it back to ANY_CRITERIA', () => {
    expect(encodeScan(ANY_CRITERIA)).toBe('scan?');
    expect(decodeLink('scan?')).toEqual({ kind: 'scan', criteria: ANY_CRITERIA });
  });

  it('round-trips a negative score floor', () => {
    expect(decodeLink(encodeScan(crit({ minScore: -2 })))).toEqual({
      kind: 'scan',
      criteria: crit({ minScore: -2 }),
    });
  });

  it('decodes defensively: unknown values degrade to any/null', () => {
    expect(decodeLink('scan?t=sideways&r=bogus&g=xx&s=abc')).toEqual({ kind: 'scan', criteria: ANY_CRITERIA });
  });

  it('tolerates a leading # on the token', () => {
    expect(decodeLink('#scan?g=low')).toEqual({ kind: 'scan', criteria: crit({ range: 'low' }) });
  });
});

describe('encodeBoard / decodeLink (board)', () => {
  it('encodes a board code and round-trips it (uppercased)', () => {
    expect(encodeBoard('rsi')).toBe('board?c=RSI');
    expect(decodeLink('board?c=RSI')).toEqual({ kind: 'board', code: 'RSI', symbol: null });
  });

  it('carries an optional focus symbol, escaping the pair separator', () => {
    const token = encodeBoard('GP', 'BTC/USDT');
    expect(token).toBe('board?c=GP&s=BTC%2FUSDT');
    expect(decodeLink(token)).toEqual({ kind: 'board', code: 'GP', symbol: 'BTC/USDT' });
  });

  it('returns null for a board token with no code, and for unknown tokens', () => {
    expect(decodeLink('board?s=BTC')).toBeNull();
    expect(decodeLink('garbage')).toBeNull();
    expect(decodeLink('')).toBeNull();
  });
});

describe('shareUrl', () => {
  it('anchors the token to the current origin as a fragment', () => {
    const url = shareUrl('board?c=RSI');
    expect(url).toContain('#board?c=RSI');
    expect(url.endsWith('#board?c=RSI')).toBe(true);
  });
});
