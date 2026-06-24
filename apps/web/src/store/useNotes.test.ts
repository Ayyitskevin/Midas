import { describe, it, expect, beforeEach } from 'vitest';
import { useNotes, GLOBAL_KEY } from '@/store/useNotes';

beforeEach(() => useNotes.setState({ notes: {} }));

describe('useNotes', () => {
  it('writes a note with a timestamp and removes it when emptied', () => {
    useNotes.getState().setNote('BTC/USDT', 'watching 70k');
    expect(useNotes.getState().notes['BTC/USDT'].text).toBe('watching 70k');
    expect(typeof useNotes.getState().notes['BTC/USDT'].updatedAt).toBe('number');

    useNotes.getState().setNote('BTC/USDT', '   ');
    expect(useNotes.getState().notes['BTC/USDT']).toBeUndefined();
  });

  it('keeps global and per-symbol notes separate', () => {
    useNotes.getState().setNote(GLOBAL_KEY, 'market choppy');
    useNotes.getState().setNote('ETH/USDT', 'flippening?');
    expect(useNotes.getState().notes[GLOBAL_KEY].text).toBe('market choppy');
    expect(useNotes.getState().notes['ETH/USDT'].text).toBe('flippening?');
  });

  it('round-trips through snapshot/restore and drops empty entries', () => {
    useNotes.getState().setNote('BTC/USDT', 'note A');
    const snap = useNotes.getState().snapshot();

    useNotes.setState({ notes: {} });
    useNotes.getState().restore(JSON.parse(JSON.stringify(snap)));
    expect(useNotes.getState().notes['BTC/USDT'].text).toBe('note A');

    // Malformed / empty entries are ignored.
    useNotes.getState().restore({ notes: { X: { text: '   ' }, Y: 5, Z: { text: 'ok' } } });
    expect(useNotes.getState().notes['X']).toBeUndefined();
    expect(useNotes.getState().notes['Z'].text).toBe('ok');

    useNotes.getState().restore(null);
    expect(useNotes.getState().notes['Z'].text).toBe('ok'); // unchanged
  });
});
