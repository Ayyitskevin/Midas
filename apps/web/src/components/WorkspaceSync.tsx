import { useAuth } from '@/store/useAuth';
import { usePanels } from '@/store/usePanels';
import { api } from '@/lib/api';
import { useServerSync } from '@/lib/useServerSync';

/**
 * Syncs the signed-in user's workspaces to the server so their setup follows
 * their account across devices: pulls on login, pushes a debounced snapshot on
 * change. Renders nothing and no-ops entirely with auth off. See
 * {@link useServerSync} for the sync mechanics.
 */
export function WorkspaceSync(): null {
  const token = useAuth((s) => s.token);
  useServerSync({
    token,
    pull: () => api.getWorkspaces(),
    push: (blob) => api.putWorkspaces(blob),
    snapshot: () => usePanels.getState().snapshot(),
    restore: (blob) => usePanels.getState().restore(blob),
    subscribe: (listener) => usePanels.subscribe(listener),
  });
  return null;
}
