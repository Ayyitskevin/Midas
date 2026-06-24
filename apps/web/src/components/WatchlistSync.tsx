import { useAuth } from '@/store/useAuth';
import { useWatchlist } from '@/store/useWatchlist';
import { api } from '@/lib/api';
import { useServerSync } from '@/lib/useServerSync';

/**
 * Syncs the signed-in user's watchlists (named lists + symbols) to the server so
 * they follow their account across devices: pulls on login, pushes a debounced
 * snapshot on change. Renders nothing and no-ops entirely with auth off. See
 * {@link useServerSync} for the sync mechanics.
 */
export function WatchlistSync(): null {
  const token = useAuth((s) => s.token);
  useServerSync({
    token,
    pull: () => api.getWatchlists(),
    push: (blob) => api.putWatchlists(blob),
    snapshot: () => useWatchlist.getState().snapshot(),
    restore: (blob) => useWatchlist.getState().restore(blob),
    subscribe: (listener) => useWatchlist.subscribe(listener),
  });
  return null;
}
