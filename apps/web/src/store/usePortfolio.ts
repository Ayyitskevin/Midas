import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { foldTrade } from '@/lib/portfolio';

/** A netted paper position in one symbol. */
export interface Position {
  id: string;
  /** Uppercase pair, e.g. BTC/USDT. */
  symbol: string;
  /** Net units held; negative means short. */
  quantity: number;
  /** Average cost basis in the quote currency. */
  entryPrice: number;
  note?: string;
  /** Epoch ms the position was first opened. */
  openedAt: number;
}

/** One executed fill in the trade journal. */
export interface Transaction {
  id: string;
  symbol: string;
  /** Signed: positive = buy, negative = sell. */
  quantity: number;
  price: number;
  /** Realized P&L booked by this fill (0 for opens / adds). */
  realized: number;
  note?: string;
  at: number;
}

interface PortfolioState {
  positions: Position[];
  /** Cumulative realized P&L across the whole journal. */
  realized: number;
  /** Executed fills, newest first (capped). */
  transactions: Transaction[];

  /** Fold a trade into the book, netting by symbol; records the fill + P&L. */
  addTrade: (symbol: string, quantity: number, price: number, note?: string) => void;
  /** Directly overwrite a position's quantity / entry / note (a correction, not a fill). */
  editPosition: (id: string, patch: Partial<Pick<Position, 'quantity' | 'entryPrice' | 'note'>>) => void;
  removePosition: (id: string) => void;
  /** Clear open positions (leaves the realized journal intact). */
  clear: () => void;
  /** Wipe the trade journal and reset realized P&L. */
  clearJournal: () => void;
}

const TX_CAP = 500;

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      positions: [],
      realized: 0,
      transactions: [],

      addTrade: (symbol, quantity, price, note) => {
        const sym = symbol.trim().toUpperCase();
        if (!sym || !Number.isFinite(quantity) || quantity === 0) return;
        if (!Number.isFinite(price) || price <= 0) return;

        const positions = get().positions;
        const existing = positions.find((p) => p.symbol === sym);
        const { position, realized } = foldTrade(
          existing ? { quantity: existing.quantity, entryPrice: existing.entryPrice } : { quantity: 0, entryPrice: 0 },
          { quantity, price },
        );

        let nextPositions: Position[];
        if (!existing) {
          nextPositions = position
            ? [
                ...positions,
                { id: newId('pos'), symbol: sym, quantity: position.quantity, entryPrice: position.entryPrice, note, openedAt: Date.now() },
              ]
            : positions;
        } else if (!position) {
          nextPositions = positions.filter((p) => p.id !== existing.id);
        } else {
          nextPositions = positions.map((p) =>
            p.id === existing.id
              ? { ...p, quantity: position.quantity, entryPrice: position.entryPrice, note: note ?? p.note }
              : p,
          );
        }

        const tx: Transaction = {
          id: newId('tx'),
          symbol: sym,
          quantity,
          price,
          realized,
          note: note?.trim() || undefined,
          at: Date.now(),
        };

        set({
          positions: nextPositions,
          realized: get().realized + realized,
          transactions: [tx, ...get().transactions].slice(0, TX_CAP),
        });
      },

      editPosition: (id, patch) => {
        set({
          positions: get().positions.flatMap((p) => {
            if (p.id !== id) return [p];
            const quantity = patch.quantity ?? p.quantity;
            if (Number.isFinite(quantity) && quantity === 0) return []; // edit to flat = remove
            return [
              {
                ...p,
                quantity: Number.isFinite(quantity) ? quantity : p.quantity,
                entryPrice:
                  patch.entryPrice != null && Number.isFinite(patch.entryPrice) && patch.entryPrice > 0
                    ? patch.entryPrice
                    : p.entryPrice,
                note: patch.note !== undefined ? patch.note : p.note,
              },
            ];
          }),
        });
      },

      removePosition: (id) => set({ positions: get().positions.filter((p) => p.id !== id) }),

      clear: () => set({ positions: [] }),

      clearJournal: () => set({ transactions: [], realized: 0 }),
    }),
    {
      name: 'midas-portfolio',
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          return { ...p, realized: 0, transactions: [] } as unknown as PortfolioState;
        }
        return persisted as PortfolioState;
      },
    },
  ),
);
