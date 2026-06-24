import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WatchlistState {
  symbols: string[];
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
  toggle: (symbol: string) => void;
  has: (symbol: string) => boolean;
  move: (symbol: string, direction: -1 | 1) => void;
}

const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT'];

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      symbols: DEFAULT_SYMBOLS,

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
    }),
    {
      name: 'midas-watchlist',
      version: 1,
    },
  ),
);
