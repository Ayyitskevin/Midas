import { useAuth } from '@/store/useAuth';
import { usePortfolio } from '@/store/usePortfolio';
import { api } from '@/lib/api';
import { useServerSync } from '@/lib/useServerSync';

/**
 * Syncs the signed-in user's paper portfolio (positions, transactions, realized
 * P&L) to the server so their book follows their account across devices: pulls
 * on login, pushes a debounced snapshot on change. Renders nothing and no-ops
 * entirely with auth off. See {@link useServerSync} for the sync mechanics.
 */
export function PortfolioSync(): null {
  const token = useAuth((s) => s.token);
  useServerSync({
    token,
    pull: () => api.getPortfolio(),
    push: (blob) => api.putPortfolio(blob),
    snapshot: () => usePortfolio.getState().snapshot(),
    restore: (blob) => usePortfolio.getState().restore(blob),
    subscribe: (listener) => usePortfolio.subscribe(listener),
  });
  return null;
}
