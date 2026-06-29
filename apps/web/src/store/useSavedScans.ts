import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScanCriteria } from '@/lib/signals';

/**
 * Saved signal-scan criteria, persisted locally. The SCAN module derives a set
 * of glanceable states per symbol (trend / RSI / 52-week range / bull-bear
 * score); a "saved scan" is a named filter over them, so a setup like "oversold
 * dips inside an uptrend" can be re-run by name instead of re-dialed each visit.
 */
export interface SavedScan {
  name: string;
  criteria: ScanCriteria;
}

interface SavedScansState {
  scans: SavedScan[];
  /** Add or overwrite the scan with this (trimmed) name; kept sorted by name. */
  save: (name: string, criteria: ScanCriteria) => void;
  remove: (name: string) => void;
}

export const useSavedScans = create<SavedScansState>()(
  persist(
    (set, get) => ({
      scans: [],
      save: (name, criteria) => {
        const n = name.trim();
        if (!n) return;
        const rest = get().scans.filter((s) => s.name !== n);
        set({ scans: [...rest, { name: n, criteria }].sort((a, b) => a.name.localeCompare(b.name)) });
      },
      remove: (name) => set({ scans: get().scans.filter((s) => s.name !== name) }),
    }),
    { name: 'midas-saved-scans' },
  ),
);
