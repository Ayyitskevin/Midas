import { describe, it, expect, beforeEach } from 'vitest';
import { decodeLink } from './deepLink';
import { encodeWorkspaceShare, decodeWorkspaceShare } from './workspaceShare';
import { usePanels } from '@/store/usePanels';
import type { WorkspaceExport } from '@/store/usePanels';

const ws = (over: Partial<WorkspaceExport> = {}): WorkspaceExport => ({
  midas: 'workspace',
  version: 1,
  name: 'Funding Desk',
  panels: [
    {
      id: '1',
      module: 'GP',
      symbol: 'BTC/USDT',
      title: 'Chart',
      link: 'yellow',
      x: 0,
      y: 0,
      w: 6,
      h: 10,
      minW: 3,
      minH: 4,
    },
    {
      id: '2',
      module: 'FUNDR',
      symbol: null,
      title: 'Funding rates',
      params: { sort: 'rate' },
      x: 6,
      y: 0,
      w: 6,
      h: 10,
      minW: 3,
      minH: 4,
    },
  ],
  ...over,
});

describe('workspace share tokens', () => {
  it('round-trips a workspace: encode → decode keeps name and panel essentials', () => {
    const token = encodeWorkspaceShare(ws());
    expect(token).toMatch(/^ws![A-Za-z0-9_-]+$/); // base64url — URL-fragment safe
    const decoded = decodeWorkspaceShare(token as string);
    expect(decoded?.name).toBe('Funding Desk');
    const data = decoded?.data as WorkspaceExport;
    expect(data.midas).toBe('workspace');
    expect(data.panels).toHaveLength(2);
    expect(data.panels[0]).toMatchObject({ module: 'GP', symbol: 'BTC/USDT', link: 'yellow', w: 6 });
    expect(data.panels[1]).toMatchObject({ module: 'FUNDR', params: { sort: 'rate' } });
  });

  it('survives unicode workspace names', () => {
    const token = encodeWorkspaceShare(ws({ name: 'Стол ФАНДИНГ 📈' }));
    expect(decodeWorkspaceShare(token as string)?.name).toBe('Стол ФАНДИНГ 📈');
  });

  it('rejects tampered, foreign and oversized tokens honestly', () => {
    const token = encodeWorkspaceShare(ws()) as string;
    expect(decodeWorkspaceShare(token.slice(0, -8))).toBeNull(); // truncated payload
    expect(decodeWorkspaceShare('ws!not-base64!!')).toBeNull();
    expect(decodeWorkspaceShare('scan?t=up')).toBeNull(); // other link kinds are not ours
    const huge = ws();
    huge.panels = Array.from({ length: 400 }, (_, i) => ({ ...huge.panels[0], id: String(i) }));
    expect(encodeWorkspaceShare(huge)).toBeNull(); // too big for a URL → use file export
  });

  it('decodeLink recognizes ws! tokens beside scan/board links', () => {
    const token = encodeWorkspaceShare(ws()) as string;
    const link = decodeLink(`#${token}`);
    expect(link?.kind).toBe('workspace');
    if (link?.kind !== 'workspace') throw new Error('expected workspace link');
    expect(link.name).toBe('Funding Desk');
    expect(decodeLink('#ws!garbage')).toBeNull();
  });
});

describe('share → import (the real path)', () => {
  beforeEach(() => {
    usePanels.setState({
      panels: [],
      counter: 0,
      activeId: null,
      activeSymbol: null,
      workspaces: [{ id: 'main', name: 'Main' }],
      activeWorkspaceId: 'main',
      savedLayouts: {},
    });
  });

  it('importWorkspace accepts a decoded share payload as a new workspace', () => {
    const decoded = decodeWorkspaceShare(encodeWorkspaceShare(ws()) as string);
    const id = usePanels.getState().importWorkspace(decoded?.data);
    const s = usePanels.getState();
    expect(s.activeWorkspaceId).toBe(id);
    expect(s.workspaces.map((w) => w.name)).toContain('Funding Desk');
    expect(s.panels).toHaveLength(2);
    expect(s.panels[0].module).toBe('GP');
    expect(s.panels[0].minW).toBeGreaterThan(0); // recomputed from module meta, not the link
  });

  it('the original workspace is untouched by an import', () => {
    usePanels.getState().openPanel({ module: 'GP', symbol: 'ETH/USDT' });
    const decoded = decodeWorkspaceShare(encodeWorkspaceShare(ws()) as string);
    usePanels.getState().importWorkspace(decoded?.data);
    const s = usePanels.getState();
    usePanels.getState().switchWorkspace('main');
    expect(usePanels.getState().panels.map((p) => p.symbol)).toEqual(['ETH/USDT']);
    expect(s.workspaces.length).toBe(2);
  });
});
