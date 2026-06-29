import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which saved scans are being "watched": the ScanWatchEngine periodically
 * re-runs each over the watchlist and notifies when new symbols match. Only the
 * set of watched names is persisted — the live match-set baseline lives in the
 * engine (in memory), so a reload re-baselines instead of replaying a backlog.
 */
interface ScanWatchesState {
  /** Names of saved scans currently being watched. */
  watched: string[];
  isWatched: (name: string) => boolean;
  toggle: (name: string) => void;
  remove: (name: string) => void;
}

export const useScanWatches = create<ScanWatchesState>()(
  persist(
    (set, get) => ({
      watched: [],
      isWatched: (name) => get().watched.includes(name),
      toggle: (name) =>
        set((s) => ({
          watched: s.watched.includes(name) ? s.watched.filter((n) => n !== name) : [...s.watched, name],
        })),
      remove: (name) => set((s) => ({ watched: s.watched.filter((n) => n !== name) })),
    }),
    { name: 'midas-scan-watches' },
  ),
);
