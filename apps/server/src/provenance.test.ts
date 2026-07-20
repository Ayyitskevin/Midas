import { describe, it, expect } from 'vitest';
import {
  provenanceNoteConsistent,
  withHonestNote,
  provenanceBadge,
  type DataProvenance,
} from '@midas/shared';
import { mockCoinUniverse } from './providers/mock/coins';

describe('provenanceNoteConsistent', () => {
  it('live requires null/empty note', () => {
    expect(provenanceNoteConsistent('live', null)).toBe(true);
    expect(provenanceNoteConsistent('live', '')).toBe(true);
    expect(provenanceNoteConsistent('live', 'stray caveat')).toBe(false);
  });

  it('synthetic and unavailable require a non-empty note', () => {
    expect(provenanceNoteConsistent('synthetic', 'demo data')).toBe(true);
    expect(provenanceNoteConsistent('unavailable', 'no source')).toBe(true);
    expect(provenanceNoteConsistent('synthetic', null)).toBe(false);
    expect(provenanceNoteConsistent('unavailable', '   ')).toBe(false);
  });
});

describe('withHonestNote', () => {
  it('clears note for live envelopes', () => {
    const out = withHonestNote(
      { provenance: 'live' as const, note: 'should clear', coins: [] },
      'fallback',
    );
    expect(out.note).toBeNull();
    expect(provenanceNoteConsistent(out.provenance, out.note)).toBe(true);
  });

  it('fills missing note for synthetic/unavailable', () => {
    for (const provenance of ['synthetic', 'unavailable'] as DataProvenance[]) {
      const out = withHonestNote({ provenance, note: null }, 'Honest fallback caveat.');
      expect(out.note).toBe('Honest fallback caveat.');
      expect(provenanceNoteConsistent(out.provenance, out.note)).toBe(true);
    }
  });

  it('preserves an existing non-empty note', () => {
    const out = withHonestNote(
      { provenance: 'synthetic' as const, note: 'Original caveat.' },
      'fallback',
    );
    expect(out.note).toBe('Original caveat.');
  });
});

describe('provenanceBadge', () => {
  it('never maps synthetic to LIVE', () => {
    expect(provenanceBadge('live')).toEqual({ label: 'LIVE', tone: 'live' });
    expect(provenanceBadge('synthetic')).toEqual({ label: 'DEMO', tone: 'demo' });
    expect(provenanceBadge('unavailable')).toEqual({ label: 'UNAVAILABLE', tone: 'off' });
  });
});

describe('mock coin universe honesty', () => {
  it('returns a consistent synthetic envelope', async () => {
    const u = await mockCoinUniverse(5);
    expect(u.provenance).toBe('synthetic');
    expect(provenanceNoteConsistent(u.provenance, u.note)).toBe(true);
    expect(u.coins.length).toBe(5);
    expect(u.coins[0]!.rank).toBe(1);
  });
});
