import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@/lib/settings';

interface SettingsState {
  settings: Settings;
  /** Merge a partial change, re-sanitizing the result. */
  update: (patch: Partial<Settings>) => void;
  /** Restore every preference to its default. */
  reset: () => void;
}

/** Terminal preferences, persisted to this browser (localStorage). */
export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => set({ settings: sanitizeSettings({ ...get().settings, ...patch }) }),
      reset: () => set({ settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: 'midas-settings',
      version: 1,
      partialize: (s) => ({ settings: s.settings }),
      // Sanitize whatever was persisted before it reaches the live store.
      merge: (persisted, current) => ({
        ...current,
        settings: sanitizeSettings((persisted as { settings?: unknown } | null)?.settings),
      }),
    },
  ),
);
