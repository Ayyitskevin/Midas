import { create } from 'zustand';

interface HotkeyHelpState {
  open: boolean;
  toggle: () => void;
  set: (open: boolean) => void;
}

/** Visibility of the keyboard-shortcuts overlay (transient; not persisted). */
export const useHotkeyHelp = create<HotkeyHelpState>((set, get) => ({
  open: false,
  toggle: () => set({ open: !get().open }),
  set: (open) => set({ open }),
}));
