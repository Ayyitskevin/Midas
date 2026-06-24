import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyTrade } from '@/lib/portfolio';

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

interface PortfolioState {
  positions: Position[];
  /** Fold a trade into the book, netting by symbol (creates/updates/closes). */
  addTrade: (symbol: string, quantity: number, price: number, note?: string) => void;
  /** Directly overwrite a position's quantity / entry / note. */
  editPosition: (id: string, patch: Partial<Pick<Position, 'quantity' | 'entryPrice' | 'note'>>) => void;
  removePosition: (id: string) => void;
  clear: () => void;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `pos_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      positions: [],

      addTrade: (symbol, quantity, price, note) => {
        const sym = symbol.trim().toUpperCase();
        if (!sym || !Number.isFinite(quantity) || quantity === 0) return;
        if (!Number.isFinite(price) || price <= 0) return;

        const positions = get().positions;
        const existing = positions.find((p) => p.symbol === sym);

        if (!existing) {
          set({
            positions: [
              ...positions,
              { id: newId(), symbol: sym, quantity, entryPrice: price, note, openedAt: Date.now() },
            ],
          });
          return;
        }

        const next = applyTrade(existing, { quantity, price });
        if (!next) {
          // Closed out → drop the row.
          set({ positions: positions.filter((p) => p.id !== existing.id) });
          return;
        }
        set({
          positions: positions.map((p) =>
            p.id === existing.id
              ? { ...p, quantity: next.quantity, entryPrice: next.entryPrice, note: note ?? p.note }
              : p,
          ),
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
    }),
    {
      name: 'midas-portfolio',
      version: 1,
    },
  ),
);
