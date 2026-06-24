import { describe, it, expect, beforeEach } from 'vitest';
import { usePanels } from '@/store/usePanels';

/** Reset the singleton store to a clean single-workspace baseline. */
function reset(): void {
  usePanels.setState({
    panels: [],
    counter: 0,
    activeId: null,
    activeSymbol: null,
    workspaces: [{ id: 'main', name: 'Main' }],
    activeWorkspaceId: 'main',
    savedLayouts: {},
  });
}

describe('usePanels snapshot/restore', () => {
  beforeEach(reset);

  it('round-trips the workspace slice through a JSON snapshot', () => {
    const s = usePanels.getState();
    s.openPanel({ module: 'DES', symbol: 'BTC/USDT' });
    s.openPanel({ module: 'GP', symbol: 'ETH/USDT' });

    const snap = usePanels.getState().snapshot();
    expect(snap.panels).toHaveLength(2);

    usePanels.getState().resetWorkspace();
    expect(usePanels.getState().panels).toHaveLength(0);

    // Restore from a serialized copy (as it would come back from the server).
    usePanels.getState().restore(JSON.parse(JSON.stringify(snap)));
    const after = usePanels.getState();
    expect(after.panels.map((p) => p.module)).toEqual(['DES', 'GP']);
    expect(after.activeId).toBeNull(); // focus is per-device, never synced
  });

  it('omits the per-device activeId from the snapshot', () => {
    const id = usePanels.getState().openPanel({ module: 'DES', symbol: 'BTC/USDT' });
    expect(usePanels.getState().activeId).toBe(id);
    expect('activeId' in usePanels.getState().snapshot()).toBe(false);
  });

  it('restores multi-workspace state including savedLayouts', () => {
    usePanels.getState().restore({
      panels: [{ module: 'DES', symbol: 'BTC/USDT', x: 0, y: 0, w: 4, h: 6 }],
      counter: 1,
      activeSymbol: 'BTC/USDT',
      workspaces: [
        { id: 'main', name: 'Main' },
        { id: 'ws2', name: 'Scalp' },
      ],
      activeWorkspaceId: 'ws2',
      savedLayouts: {
        main: { panels: [{ module: 'GP', symbol: 'ETH/USDT' }], counter: 1, activeSymbol: 'ETH/USDT' },
      },
    });
    const s = usePanels.getState();
    expect(s.workspaces).toHaveLength(2);
    expect(s.activeWorkspaceId).toBe('ws2');
    expect(s.savedLayouts.main.panels[0].module).toBe('GP');
  });

  it('ignores a malformed blob and leaves state untouched', () => {
    usePanels.getState().openPanel({ module: 'DES', symbol: 'BTC/USDT' });
    const before = usePanels.getState().panels.length;
    for (const bad of [null, 'nope', 42, undefined]) {
      usePanels.getState().restore(bad);
    }
    expect(usePanels.getState().panels).toHaveLength(before);
  });

  it('always yields a workspace and a valid active id from a partial blob', () => {
    usePanels.getState().restore({ panels: [], activeWorkspaceId: 'ghost' });
    const s = usePanels.getState();
    expect(s.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(s.workspaces.some((w) => w.id === s.activeWorkspaceId)).toBe(true);
  });

  it('drops malformed panels but keeps valid ones', () => {
    usePanels.getState().restore({
      workspaces: [{ id: 'main', name: 'Main' }],
      activeWorkspaceId: 'main',
      panels: [
        { module: 'DES', symbol: 'BTC/USDT' },
        { module: 'NOPE', symbol: 'X' }, // unknown module → dropped
        { nonsense: true }, // not a panel → dropped
      ],
    });
    expect(usePanels.getState().panels).toHaveLength(1);
    expect(usePanels.getState().panels[0].module).toBe('DES');
  });
});
