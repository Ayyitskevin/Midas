import { describe, it, expect, afterEach, vi } from 'vitest';
import { gtData, gtFetch, parsePairName, num, str } from './gecko';

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

// gtFetch is the honesty-critical chokepoint shared by STREND, SOLDEX and SOLMKT:
// its non-2xx throw is what makes an upstream failure degrade to 'unavailable'
// rather than a fabricated 'live' read, so it must stay covered.
describe('gtFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON on a 200 and sends Accept: application/json', async () => {
    let sentAccept: string | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: { headers?: Record<string, string> }) => {
      sentAccept = init.headers?.Accept;
      return { ok: true, status: 200, json: async () => ({ data: [{ attributes: {} }] }) } as Response;
    });
    const body = (await gtFetch('https://gecko.example/pools')) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    expect(sentAccept).toBe('application/json');
  });

  it('throws "HTTP <status>" on a non-2xx so the caller degrades to unavailable', async () => {
    // This is the honesty-critical guard: a non-2xx must throw so the mapper is
    // never reached with an error body and no snapshot is mislabeled 'live'.
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    await expect(gtFetch('https://gecko.example/pools')).rejects.toThrow(/HTTP 500/);
  });
});
