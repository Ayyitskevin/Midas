import { describe, it, expect, beforeEach } from 'vitest';
import { useScanWatches } from './useScanWatches';

describe('useScanWatches', () => {
  beforeEach(() => useScanWatches.setState({ watched: [] }));

  it('toggles a scan watch on and off and reports membership', () => {
    const s = useScanWatches.getState();
    expect(s.isWatched('dips')).toBe(false);
    s.toggle('dips');
    expect(useScanWatches.getState().watched).toEqual(['dips']);
    expect(useScanWatches.getState().isWatched('dips')).toBe(true);
    useScanWatches.getState().toggle('dips');
    expect(useScanWatches.getState().watched).toEqual([]);
  });

  it('removes a watch by name without disturbing others', () => {
    const s = useScanWatches.getState();
    s.toggle('dips');
    s.toggle('breakouts');
    useScanWatches.getState().remove('dips');
    expect(useScanWatches.getState().watched).toEqual(['breakouts']);
  });
});
