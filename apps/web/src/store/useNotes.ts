import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Key for the catch-all market note (vs. a per-symbol note keyed by symbol). */
export const GLOBAL_KEY = '__global__';

export interface NoteEntry {
  text: string;
  updatedAt: number;
}

/** The notes slice synced to the server (one blob per user). */
export interface NotesSnapshot {
  notes: Record<string, NoteEntry>;
}

interface NotesState {
  /** Notes keyed by GLOBAL_KEY or an uppercase symbol. */
  notes: Record<string, NoteEntry>;
  /** Write a note; empty/whitespace text removes the entry. */
  setNote: (key: string, text: string) => void;
  removeNote: (key: string) => void;
  snapshot: () => NotesSnapshot;
  restore: (blob: unknown) => void;
}

/** Coerce an untrusted server blob into a NotesSnapshot, or null. */
function parseNotes(data: unknown): NotesSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as Record<string, unknown>).notes;
  if (!raw || typeof raw !== 'object') return null;
  const notes: Record<string, NoteEntry> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const { text, updatedAt } = val as Record<string, unknown>;
    if (typeof text === 'string' && text.trim() !== '') {
      notes[key] = { text, updatedAt: typeof updatedAt === 'number' ? updatedAt : 0 };
    }
  }
  return { notes };
}

export const useNotes = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: {},

      setNote: (key, text) => {
        const k = key.trim();
        if (!k) return;
        const notes = { ...get().notes };
        if (text.trim() === '') delete notes[k];
        else notes[k] = { text, updatedAt: Date.now() };
        set({ notes });
      },

      removeNote: (key) => {
        const notes = { ...get().notes };
        delete notes[key];
        set({ notes });
      },

      snapshot: () => ({ notes: get().notes }),

      restore: (blob) => {
        const snap = parseNotes(blob);
        if (snap) set({ notes: snap.notes });
      },
    }),
    { name: 'midas-notes', version: 1 },
  ),
);
