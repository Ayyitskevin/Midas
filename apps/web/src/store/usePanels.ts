import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModuleCode } from '@/modules/meta';
import { MODULE_META } from '@/modules/meta';

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

interface PanelsState {
  panels: PanelState[];
  counter: number;
  activeId: string | null;
  activeSymbol: string | null;
  openPanel: (args: OpenPanelArgs) => string;
  closePanel: (id: string) => void;
  focusPanel: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  setPanelSymbol: (id: string, symbol: string) => void;
  setPanelParams: (id: string, params: PanelParams) => void;
  resetWorkspace: () => void;
}

const COLS = 12;

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
                  p.id === existing.id
                    ? { ...p, params: { ...p.params, ...args.params } }
                    : p,
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
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, symbol: upper } : p)),
          activeSymbol: upper,
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
    }),
    {
      name: 'midas-panels',
      version: 1,
      partialize: (state) => ({
        panels: state.panels,
        counter: state.counter,
        activeSymbol: state.activeSymbol,
      }),
    },
  ),
);
