import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Pinned/favorite screener boards, persisted locally. Lets the catalog surface
 * the handful of boards a user actually relies on at the top, instead of
 * scrolling the full ~115 every time.
 */
export interface BoardFavoritesState {
  /** Favorited board codes, in the order pinned. */
  favorites: string[];
  isFavorite: (code: string) => boolean;
  toggle: (code: string) => void;
}

export const useBoardFavorites = create<BoardFavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      isFavorite: (code) => get().favorites.includes(code),
      toggle: (code) =>
        set((s) => ({
          favorites: s.favorites.includes(code)
            ? s.favorites.filter((c) => c !== code)
            : [...s.favorites, code],
        })),
    }),
    { name: 'midas-board-favorites' },
  ),
);
