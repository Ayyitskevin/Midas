import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModuleCode } from '@/modules/meta';
import { MODULE_META } from '@/modules/meta';

/** A panel "link group" — panels sharing a color sync their symbol. */
export type LinkColor = 'red' | 'blue' | 'green' | 'yellow' | 'cyan' | 'orange' | 'magenta';

export const LINK_COLORS: readonly LinkColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'cyan',
  'orange',
  'magenta',
];

export interface PanelParams {
  interval?: string;
  range?: string;
  [key: string]: unknown;
}

export interface PanelState {
  id: string;
  module: ModuleCode;
  symbol: string | null;
  title: string;
  params?: PanelParams;
  /** Link group; panels with the same color sync their symbol. */
  link?: LinkColor;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export interface OpenPanelArgs {
  module: ModuleCode;
  symbol: string | null;
  title?: string;
  params?: PanelParams;
}

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
}

/** The per-workspace state swapped in/out as the user switches workspaces. */
interface WorkspaceData {
  panels: PanelState[];
  counter: number;
  activeSymbol: string | null;
}

interface PanelsState {
  // Active workspace working state (kept at the top level so all existing
  // selectors/actions keep operating on the current workspace unchanged).
  panels: PanelState[];
  counter: number;
  activeId: string | null;
  activeSymbol: string | null;

  // Workspaces.
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string;
  /** Saved state of inactive workspaces. */
  savedLayouts: Record<string, WorkspaceData>;

  // Panel actions (operate on the active workspace).
  openPanel: (args: OpenPanelArgs) => string;
  closePanel: (id: string) => void;
  focusPanel: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  setPanelSymbol: (id: string, symbol: string) => void;
  setPanelLink: (id: string, link: LinkColor | null) => void;
  setPanelParams: (id: string, params: PanelParams) => void;
  resetWorkspace: () => void;

  // Workspace actions.
  addWorkspace: (name?: string) => string;
  switchWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  closeWorkspace: (id: string) => void;
}

const COLS = 12;
const DEFAULT_WORKSPACE_ID = 'main';

function newWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** First free top-left slot in the 12-column grid that fits a w×h panel. */
function findSlot(panels: PanelState[], w: number, h: number): { x: number; y: number } {
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x <= COLS - w; x++) {
      const candidate = { x, y, w, h };
      if (!panels.some((p) => rectsOverlap(candidate, p))) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}

export const usePanels = create<PanelsState>()(
  persist(
    (set, get) => ({
      panels: [],
      counter: 0,
      activeId: null,
      activeSymbol: null,
      workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Main' }],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      savedLayouts: {},

      openPanel: (args) => {
        const { panels, counter, activeSymbol } = get();
        const symbol = args.symbol ? args.symbol.toUpperCase() : null;

        // Dedupe: same module + same symbol focuses the existing panel.
        const existing = panels.find(
          (p) => p.module === args.module && (p.symbol ?? '') === (symbol ?? ''),
        );
        if (existing) {
          set({
            activeId: existing.id,
            activeSymbol: symbol ?? activeSymbol,
            panels: args.params
              ? panels.map((p) =>
                  p.id === existing.id ? { ...p, params: { ...p.params, ...args.params } } : p,
                )
              : panels,
          });
          return existing.id;
        }

        const meta = MODULE_META[args.module];
        const slot = findSlot(panels, meta.w, meta.h);
        const id = String(counter + 1);
        const panel: PanelState = {
          id,
          module: args.module,
          symbol,
          title: args.title ?? meta.title,
          params: args.params,
          x: slot.x,
          y: slot.y,
          w: meta.w,
          h: meta.h,
          minW: meta.minW,
          minH: meta.minH,
        };

        set({
          panels: [...panels, panel],
          counter: counter + 1,
          activeId: id,
          activeSymbol: symbol ?? activeSymbol,
        });
        return id;
      },

      closePanel: (id) => {
        const { panels, activeId } = get();
        const remaining = panels.filter((p) => p.id !== id);
        set({
          panels: remaining,
          activeId: activeId === id ? (remaining[remaining.length - 1]?.id ?? null) : activeId,
        });
      },

      focusPanel: (id) => {
        const panel = get().panels.find((p) => p.id === id);
        set({ activeId: id, activeSymbol: panel?.symbol ?? get().activeSymbol });
      },

      setLayout: (layout) => {
        const byId = new Map(layout.map((l) => [l.i, l]));
        set({
          panels: get().panels.map((p) => {
            const l = byId.get(p.id);
            return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p;
          }),
        });
      },

      setPanelSymbol: (id, symbol) => {
        const upper = symbol.toUpperCase();
        const { panels } = get();
        const link = panels.find((p) => p.id === id)?.link;
        set({
          // A linked panel broadcasts the new symbol to every panel in its group.
          panels: panels.map((p) => {
            if (p.id === id) return { ...p, symbol: upper };
            if (link && p.link === link) return { ...p, symbol: upper };
            return p;
          }),
          activeSymbol: upper,
        });
      },

      setPanelLink: (id, link) => {
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, link: link ?? undefined } : p)),
        });
      },

      setPanelParams: (id, params) => {
        set({
          panels: get().panels.map((p) =>
            p.id === id ? { ...p, params: { ...p.params, ...params } } : p,
          ),
        });
      },

      resetWorkspace: () => set({ panels: [], counter: 0, activeId: null }),

      addWorkspace: (name) => {
        const s = get();
        const id = newWorkspaceId();
        set({
          workspaces: [...s.workspaces, { id, name: name?.trim() || `WS ${s.workspaces.length + 1}` }],
          savedLayouts: {
            ...s.savedLayouts,
            [s.activeWorkspaceId]: {
              panels: s.panels,
              counter: s.counter,
              activeSymbol: s.activeSymbol,
            },
          },
          activeWorkspaceId: id,
          panels: [],
          counter: 0,
          activeId: null,
          // keep activeSymbol so the fresh workspace can reuse the current symbol
        });
        return id;
      },

      switchWorkspace: (id) => {
        const s = get();
        if (id === s.activeWorkspaceId || !s.workspaces.some((w) => w.id === id)) return;
        const savedLayouts = { ...s.savedLayouts };
        savedLayouts[s.activeWorkspaceId] = {
          panels: s.panels,
          counter: s.counter,
          activeSymbol: s.activeSymbol,
        };
        const target = savedLayouts[id] ?? { panels: [], counter: 0, activeSymbol: null };
        delete savedLayouts[id];
        set({
          savedLayouts,
          activeWorkspaceId: id,
          panels: target.panels,
          counter: target.counter,
          activeSymbol: target.activeSymbol,
          activeId: null,
        });
      },

      renameWorkspace: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({
          workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
        });
      },

      closeWorkspace: (id) => {
        const s = get();
        if (s.workspaces.length <= 1) return; // always keep at least one
        const remaining = s.workspaces.filter((w) => w.id !== id);
        const savedLayouts = { ...s.savedLayouts };
        delete savedLayouts[id];

        if (id === s.activeWorkspaceId) {
          const next = remaining[0];
          const target = savedLayouts[next.id] ?? { panels: [], counter: 0, activeSymbol: null };
          delete savedLayouts[next.id];
          set({
            workspaces: remaining,
            savedLayouts,
            activeWorkspaceId: next.id,
            panels: target.panels,
            counter: target.counter,
            activeSymbol: target.activeSymbol,
            activeId: null,
          });
        } else {
          set({ workspaces: remaining, savedLayouts });
        }
      },
    }),
    {
      name: 'midas-panels',
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          return {
            ...p,
            workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Main' }],
            activeWorkspaceId: DEFAULT_WORKSPACE_ID,
            savedLayouts: {},
          } as unknown as PanelsState;
        }
        return persisted as PanelsState;
      },
      partialize: (state) => ({
        panels: state.panels,
        counter: state.counter,
        activeSymbol: state.activeSymbol,
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
        savedLayouts: state.savedLayouts,
      }),
    },
  ),
);
