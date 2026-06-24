import { useAuth } from '@/store/useAuth';
import { useNotes } from '@/store/useNotes';
import { api } from '@/lib/api';
import { useServerSync } from '@/lib/useServerSync';

/**
 * Syncs the signed-in user's notes to the server so they follow their account
 * across devices: pulls on login, pushes a debounced snapshot on change.
 * Renders nothing and no-ops entirely with auth off. See {@link useServerSync}.
 */
export function NotesSync(): null {
  const token = useAuth((s) => s.token);
  useServerSync({
    token,
    pull: () => api.getNotes(),
    push: (blob) => api.putNotes(blob),
    snapshot: () => useNotes.getState().snapshot(),
    restore: (blob) => useNotes.getState().restore(blob),
    subscribe: (listener) => useNotes.subscribe(listener),
  });
  return null;
}
