import { describe, it, expect, beforeEach } from 'vitest';
import { useWatchlist } from '@/store/useWatchlist';

function reset(): void {
  useWatchlist.setState({
    symbols: ['BTC/USDT'],
    lists: [{ id: 'default', name: 'Watchlist' }],
    activeId: 'default',
    saved: {},
  });
}

describe('useWatchlist multi-list', () => {
  beforeEach(reset);

  it('adds a list, preserving the previous list’s symbols', () => {
    const s = useWatchlist.getState();
    const id = s.addList('Alts');
    const after = useWatchlist.getState();
    expect(after.activeId).toBe(id);
    expect(after.symbols).toEqual([]); // fresh list starts empty
    expect(after.saved['default']).toEqual(['BTC/USDT']); // old list parked
    expect(after.lists.map((l) => l.name)).toEqual(['Watchlist', 'Alts']);
  });

  it('switches lists, swapping the active symbol set', () => {
    const id = useWatchlist.getState().addList('Alts');
    useWatchlist.getState().add('PEPE/USDT');
    useWatchlist.getState().switchList('default');
    expect(useWatchlist.getState().symbols).toEqual(['BTC/USDT']);
    useWatchlist.getState().switchList(id);
    expect(useWatchlist.getState().symbols).toEqual(['PEPE/USDT']);
  });

  it('removes a list and never drops below one', () => {
    const id = useWatchlist.getState().addList('Alts'); // now active
    useWatchlist.getState().removeList(id); // removing active → falls back
    expect(useWatchlist.getState().lists).toHaveLength(1);
    expect(useWatchlist.getState().activeId).toBe('default');
    expect(useWatchlist.getState().symbols).toEqual(['BTC/USDT']);
    // Can't remove the last remaining list.
    useWatchlist.getState().removeList('default');
    expect(useWatchlist.getState().lists).toHaveLength(1);
  });

  it('renames a list', () => {
    useWatchlist.getState().renameList('default', '  Majors  ');
    expect(useWatchlist.getState().lists[0].name).toBe('Majors');
  });
});

describe('useWatchlist snapshot/restore', () => {
  beforeEach(reset);

  it('round-trips the full multi-list slice', () => {
    const id = useWatchlist.getState().addList('Alts');
    useWatchlist.getState().add('PEPE/USDT');
    const snap = useWatchlist.getState().snapshot();

    reset();
    useWatchlist.getState().restore(JSON.parse(JSON.stringify(snap)));
    const after = useWatchlist.getState();
    expect(after.lists.map((l) => l.name)).toEqual(['Watchlist', 'Alts']);
    expect(after.activeId).toBe(id);
    expect(after.symbols).toEqual(['PEPE/USDT']);
    expect(after.saved['default']).toEqual(['BTC/USDT']);
  });

  it('ignores malformed blobs and guarantees a valid active list', () => {
    const before = useWatchlist.getState().lists.length;
    for (const bad of [null, 'nope', 42]) useWatchlist.getState().restore(bad);
    expect(useWatchlist.getState().lists).toHaveLength(before);

    useWatchlist.getState().restore({ symbols: ['X'], activeId: 'ghost' });
    const s = useWatchlist.getState();
    expect(s.lists.length).toBeGreaterThanOrEqual(1);
    expect(s.lists.some((l) => l.id === s.activeId)).toBe(true);
  });
});
