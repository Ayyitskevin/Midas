import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A named watchlist (metadata only; the active list's symbols live top-level). */
export interface WatchlistMeta {
  id: string;
  name: string;
}

/** The full multi-list slice synced to the server (one blob per user). */
export interface WatchlistSnapshot {
  symbols: string[];
  lists: WatchlistMeta[];
  activeId: string;
  saved: Record<string, string[]>;
}

interface WatchlistState {
  // Active list's working state at the top level, so every existing consumer
  // (`s.symbols`, add/remove/toggle/has/move) keeps operating on the current
  // list unchanged.
  symbols: string[];
  lists: WatchlistMeta[];
  activeId: string;
  /** Inactive lists' symbols, keyed by list id. */
  saved: Record<string, string[]>;

  // Symbol actions (operate on the active list).
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
  toggle: (symbol: string) => void;
  has: (symbol: string) => boolean;
  move: (symbol: string, direction: -1 | 1) => void;

  // List actions.
  addList: (name?: string) => string;
  switchList: (id: string) => void;
  renameList: (id: string, name: string) => void;
  removeList: (id: string) => void;

  // Server sync (per-user, across devices).
  snapshot: () => WatchlistSnapshot;
  restore: (blob: unknown) => void;
}

const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT'];
const DEFAULT_ID = 'default';

function newListId(): string {
  return `wl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const cleanSymbols = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];

/** Coerce an untrusted blob into a valid snapshot, or null. Always ≥ 1 list. */
function parseSnapshot(data: unknown): WatchlistSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const lists: WatchlistMeta[] = [];
  if (Array.isArray(d.lists)) {
    for (const l of d.lists) {
      if (l && typeof l === 'object') {
        const { id, name } = l as Record<string, unknown>;
        if (typeof id === 'string' && typeof name === 'string') lists.push({ id, name });
      }
    }
  }
  if (lists.length === 0) lists.push({ id: DEFAULT_ID, name: 'Watchlist' });

  const saved: Record<string, string[]> = {};
  if (d.saved && typeof d.saved === 'object') {
    for (const [id, syms] of Object.entries(d.saved as Record<string, unknown>)) {
      saved[id] = cleanSymbols(syms);
    }
  }

  const activeId =
    typeof d.activeId === 'string' && lists.some((l) => l.id === d.activeId)
      ? d.activeId
      : lists[0].id;

  return { symbols: cleanSymbols(d.symbols), lists, activeId, saved };
}

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      symbols: DEFAULT_SYMBOLS,
      lists: [{ id: DEFAULT_ID, name: 'Watchlist' }],
      activeId: DEFAULT_ID,
      saved: {},

      add: (symbol) => {
        const s = symbol.trim().toUpperCase();
        if (!s) return;
        const { symbols } = get();
        if (symbols.includes(s)) return;
        set({ symbols: [...symbols, s] });
      },

      remove: (symbol) => {
        const s = symbol.toUpperCase();
        set({ symbols: get().symbols.filter((x) => x !== s) });
      },

      toggle: (symbol) => {
        const s = symbol.trim().toUpperCase();
        if (!s) return;
        const { symbols } = get();
        set({
          symbols: symbols.includes(s) ? symbols.filter((x) => x !== s) : [...symbols, s],
        });
      },

      has: (symbol) => get().symbols.includes(symbol.toUpperCase()),

      move: (symbol, direction) => {
        const symbols = [...get().symbols];
        const i = symbols.indexOf(symbol.toUpperCase());
        const j = i + direction;
        if (i < 0 || j < 0 || j >= symbols.length) return;
        [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
        set({ symbols });
      },

      addList: (name) => {
        const s = get();
        const id = newListId();
        set({
          lists: [...s.lists, { id, name: name?.trim() || `List ${s.lists.length + 1}` }],
          saved: { ...s.saved, [s.activeId]: s.symbols },
          activeId: id,
          symbols: [],
        });
        return id;
      },

      switchList: (id) => {
        const s = get();
        if (id === s.activeId || !s.lists.some((l) => l.id === id)) return;
        const saved = { ...s.saved, [s.activeId]: s.symbols };
        const symbols = saved[id] ?? [];
        delete saved[id];
        set({ saved, activeId: id, symbols });
      },

      renameList: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({ lists: get().lists.map((l) => (l.id === id ? { ...l, name: trimmed } : l)) });
      },

      removeList: (id) => {
        const s = get();
        if (s.lists.length <= 1) return; // always keep one
        const remaining = s.lists.filter((l) => l.id !== id);
        const saved = { ...s.saved };
        delete saved[id];
        if (id === s.activeId) {
          const next = remaining[0];
          const symbols = saved[next.id] ?? [];
          delete saved[next.id];
          set({ lists: remaining, saved, activeId: next.id, symbols });
        } else {
          set({ lists: remaining, saved });
        }
      },

      snapshot: () => {
        const s = get();
        return { symbols: s.symbols, lists: s.lists, activeId: s.activeId, saved: s.saved };
      },

      restore: (blob) => {
        const snap = parseSnapshot(blob);
        if (!snap) return;
        set({ symbols: snap.symbols, lists: snap.lists, activeId: snap.activeId, saved: snap.saved });
      },
    }),
    {
      name: 'midas-watchlist',
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          return {
            ...p,
            symbols: Array.isArray(p.symbols) ? p.symbols : DEFAULT_SYMBOLS,
            lists: [{ id: DEFAULT_ID, name: 'Watchlist' }],
            activeId: DEFAULT_ID,
            saved: {},
          } as unknown as WatchlistState;
        }
        return persisted as WatchlistState;
      },
      partialize: (state) => ({
        symbols: state.symbols,
        lists: state.lists,
        activeId: state.activeId,
        saved: state.saved,
      }),
    },
  ),
);
