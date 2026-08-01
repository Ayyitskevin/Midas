import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Caps so localStorage can't grow unbounded (oldest entries evicted first). */
export const MAX_DRAWINGS_PER_SYMBOL = 100;
export const MAX_SYMBOLS = 200;

export interface DrawingPoint {
  time: number;
  price: number;
}

/** A persisted chart drawing: a horizontal line, a trendline, or a fib set. */
export type Drawing =
  | { id: string; type: 'hline'; price: number }
  | { id: string; type: 'trend'; a: DrawingPoint; b: DrawingPoint }
  | { id: string; type: 'fib'; a: DrawingPoint; b: DrawingPoint };

/** A drawing before the store assigns its id. */
export type DrawingDraft =
  | { type: 'hline'; price: number }
  | { type: 'trend'; a: DrawingPoint; b: DrawingPoint }
  | { type: 'fib'; a: DrawingPoint; b: DrawingPoint };

interface DrawingsState {
  /** Drawings keyed by uppercase symbol, in insertion (LRU) order. */
  drawings: Record<string, Drawing[]>;
  /** Append a drawing to a symbol's set; returns it with its assigned id. */
  addDrawing: (symbol: string, draft: DrawingDraft) => Drawing;
  clearSymbol: (symbol: string) => void;
}

function uid(): string {
  return `dr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function point(v: unknown): DrawingPoint | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const time = num(p.time);
  const price = num(p.price);
  return time == null || price == null ? null : { time, price };
}

/** Coerce one untrusted drawing into a valid Drawing, or null to drop it. */
function sanitizeDrawing(raw: unknown): Drawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : uid();
  if (r.type === 'hline') {
    const price = num(r.price);
    return price == null ? null : { id, type: 'hline', price };
  }
  if (r.type === 'trend' || r.type === 'fib') {
    const a = point(r.a);
    const b = point(r.b);
    return a && b ? { id, type: r.type, a, b } : null;
  }
  return null;
}

/** Enforce MAX_SYMBOLS on an insertion-ordered map, evicting the oldest keys. */
function capSymbols(map: Record<string, Drawing[]>): Record<string, Drawing[]> {
  const keys = Object.keys(map);
  if (keys.length <= MAX_SYMBOLS) return map;
  const out = { ...map };
  for (const k of keys.slice(0, keys.length - MAX_SYMBOLS)) delete out[k];
  return out;
}

/**
 * Coerce an untrusted persisted/imported blob into a clean per-symbol map:
 * malformed drawings and unusable keys are dropped and the caps are enforced,
 * so a corrupt or tampered store can never crash rehydration.
 */
function sanitizeDrawings(data: unknown): Record<string, Drawing[]> {
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, Drawing[]> = {};
  for (const [symbol, list] of Object.entries(data as Record<string, unknown>)) {
    if (!symbol || !Array.isArray(list)) continue;
    const clean: Drawing[] = [];
    for (const raw of list) {
      const d = sanitizeDrawing(raw);
      if (d) clean.push(d);
    }
    if (clean.length > 0) out[symbol] = clean.slice(-MAX_DRAWINGS_PER_SYMBOL);
  }
  return capSymbols(out);
}

/** Chart drawings, persisted per symbol to this browser (localStorage). */
export const useDrawings = create<DrawingsState>()(
  persist(
    (set, get) => ({
      drawings: {},

      addDrawing: (symbol, draft) => {
        const key = symbol.toUpperCase();
        const drawing = { ...draft, id: uid() } as Drawing;
        const drawings = { ...get().drawings };
        // Delete + re-insert so the key moves to the end (most recently used).
        delete drawings[key];
        drawings[key] = [...(get().drawings[key] ?? []), drawing].slice(-MAX_DRAWINGS_PER_SYMBOL);
        set({ drawings: capSymbols(drawings) });
        return drawing;
      },

      clearSymbol: (symbol) => {
        const drawings = { ...get().drawings };
        delete drawings[symbol.toUpperCase()];
        set({ drawings });
      },
    }),
    {
      name: 'midas-drawings',
      version: 1,
      migrate: (persisted, version) => {
        // No pre-v1 shape ever shipped; anything older starts empty.
        if (version < 1) return { drawings: {} } as DrawingsState;
        return persisted as DrawingsState;
      },
      merge: (persisted, current) => ({
        ...current,
        drawings: sanitizeDrawings((persisted as { drawings?: unknown } | null)?.drawings),
      }),
    },
  ),
);
