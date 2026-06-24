import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JournalTrade, TradeSide } from '@/lib/journal';

export interface NewTrade {
  symbol: string;
  side: TradeSide;
  entry: number;
  stop: number;
  exit: number | null;
  size: number | null;
  note: string;
}

interface JournalState {
  trades: JournalTrade[];
  addTrade: (t: NewTrade) => void;
  /** Close an open trade by setting its exit price. */
  closeTrade: (id: string, exit: number) => void;
  removeTrade: (id: string) => void;
  clear: () => void;
}

function uid(): string {
  return `tr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce an untrusted persisted blob into a clean trade list. */
function sanitizeTrades(data: unknown): JournalTrade[] {
  if (!Array.isArray(data)) return [];
  const out: JournalTrade[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const entry = num(r.entry);
    const stop = num(r.stop);
    if (entry == null || stop == null) continue; // entry & stop are the minimum a trade needs
    out.push({
      id: typeof r.id === 'string' ? r.id : uid(),
      symbol: typeof r.symbol === 'string' ? r.symbol : '',
      side: r.side === 'short' ? 'short' : 'long',
      entry,
      stop,
      exit: num(r.exit),
      size: num(r.size),
      openedAt: num(r.openedAt) ?? 0,
      closedAt: num(r.closedAt),
      note: typeof r.note === 'string' ? r.note : '',
    });
  }
  return out;
}

/** Trade journal, persisted to this browser (localStorage). */
export const useJournal = create<JournalState>()(
  persist(
    (set, get) => ({
      trades: [],

      addTrade: (t) => {
        const now = Date.now();
        const trade: JournalTrade = {
          id: uid(),
          symbol: t.symbol.toUpperCase(),
          side: t.side,
          entry: t.entry,
          stop: t.stop,
          exit: t.exit,
          size: t.size,
          openedAt: now,
          closedAt: t.exit != null ? now : null,
          note: t.note,
        };
        set({ trades: [trade, ...get().trades] }); // newest first
      },

      closeTrade: (id, exit) =>
        set({
          trades: get().trades.map((tr) =>
            tr.id === id ? { ...tr, exit, closedAt: Date.now() } : tr,
          ),
        }),

      removeTrade: (id) => set({ trades: get().trades.filter((tr) => tr.id !== id) }),

      clear: () => set({ trades: [] }),
    }),
    {
      name: 'midas-journal',
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        trades: sanitizeTrades((persisted as { trades?: unknown } | null)?.trades),
      }),
    },
  ),
);
