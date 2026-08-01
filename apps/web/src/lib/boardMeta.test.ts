import { describe, it, expect } from 'vitest';
import { boardMetaView, fmtAge } from '@/lib/boardMeta';
import type { BoardMeta } from '@midas/shared';

const NOW = 1_700_000_000_000;

const meta = (over: Partial<BoardMeta> = {}): BoardMeta => ({
  provenance: 'live',
  source: 'ccxt:binance',
  asOf: NOW - 30_000,
  cachedAt: null,
  partial: false,
  note: null,
  ...over,
});

describe('fmtAge', () => {
  it('renders now / seconds / minutes / hours / days', () => {
    expect(fmtAge(NOW - 5_000, NOW)).toBe('now');
    expect(fmtAge(NOW - 42_000, NOW)).toBe('42s ago');
    expect(fmtAge(NOW - 3 * 60_000, NOW)).toBe('3m ago');
    expect(fmtAge(NOW - 2 * 3_600_000, NOW)).toBe('2h ago');
    expect(fmtAge(NOW - 5 * 86_400_000, NOW)).toBe('5d ago');
  });

  it('treats future timestamps as now', () => {
    expect(fmtAge(NOW + 60_000, NOW)).toBe('now');
  });
});

describe('boardMetaView', () => {
  it('labels a fresh live board with the up-tone dot', () => {
    const v = boardMetaView(meta(), NOW);
    expect(v.label).toBe('live');
    expect(v.dotClass).toBe('bg-term-up');
    expect(v.ageText).toBe('30s ago');
    expect(v.warn).toBe(false);
    expect(v.note).toBeNull();
  });

  it('distinguishes a cached (stale) board from a fresh one', () => {
    const v = boardMetaView(meta({ cachedAt: NOW - 10_000 }), NOW);
    expect(v.label).toBe('cached');
    expect(v.dotClass).toBe('bg-term-amber');
    expect(v.title).toContain('cache');
  });

  it('labels synthetic data and warns loudly', () => {
    const v = boardMetaView(
      meta({ provenance: 'synthetic', source: 'mock', note: 'Synthetic demo data — not a live feed' }),
      NOW,
    );
    expect(v.label).toBe('synthetic');
    expect(v.dotClass).toBe('bg-term-amber');
    expect(v.warn).toBe(true);
    expect(v.note).toContain('Synthetic');
  });

  it('labels an unavailable board with the down-tone dot', () => {
    const v = boardMetaView(meta({ provenance: 'unavailable', note: 'No source' }), NOW);
    expect(v.label).toBe('unavailable');
    expect(v.dotClass).toBe('bg-term-down');
    expect(v.warn).toBe(true);
  });

  it('synthesizes an honest note for a partial board that has none', () => {
    const v = boardMetaView(meta({ partial: true }), NOW);
    expect(v.note).toContain('dropped');
    expect(v.warn).toBe(true);
    expect(v.dotClass).toBe('bg-term-amber');
  });

  it('keeps the server note on a partial cached board', () => {
    const v = boardMetaView(meta({ cachedAt: NOW, partial: true, note: 'kraken timeout' }), NOW);
    expect(v.label).toBe('cached');
    expect(v.note).toBe('kraken timeout');
    expect(v.warn).toBe(true);
  });
});
