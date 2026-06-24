import { useEffect, useRef } from 'react';
import { useAuth } from '@/store/useAuth';
import { usePanels } from '@/store/usePanels';
import { api } from '@/lib/api';

/** Wait this long after the last layout change before pushing to the server. */
const PUSH_DEBOUNCE_MS = 1500;

/**
 * Syncs the signed-in user's workspaces to the server so their setup follows
 * their account across devices. On login it pulls the server snapshot and
 * restores it; while logged in it pushes a debounced snapshot whenever the
 * layout changes. Renders nothing.
 *
 * With auth off (no token) it does nothing at all — the single-user experience
 * keeps relying solely on localStorage, unchanged. Pushes are content-guarded
 * so a freshly-pulled snapshot never echoes straight back.
 */
export function WorkspaceSync(): null {
  const token = useAuth((s) => s.token);
  // Serialized form of the last snapshot we synced — the echo/no-op guard.
  const lastSynced = useRef<string | null>(null);
  // Becomes true once the initial pull has baselined `lastSynced`.
  const ready = useRef(false);

  // Pull on login (and whenever the identity/token changes).
  useEffect(() => {
    ready.current = false;
    lastSynced.current = null;
    if (!token) return;

    let cancelled = false;
    const baseline = (): void => {
      if (cancelled) return;
      // What we'd push right now becomes the baseline, so an unchanged layout
      // (including the one we just pulled) never echoes back to the server.
      lastSynced.current = JSON.stringify(usePanels.getState().snapshot());
      ready.current = true;
    };

    api
      .getWorkspaces()
      .then((res) => {
        if (cancelled) return;
        if (res.snapshot) usePanels.getState().restore(res.snapshot.blob);
        baseline();
      })
      .catch(() => {
        // Offline / transient — keep the local layout but still allow this
        // device to push once it changes, baselined to the current state.
        baseline();
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Push debounced whenever the synced slice changes.
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
      const blob = usePanels.getState().snapshot();
      const serialized = JSON.stringify(blob);
      if (serialized === lastSynced.current) return; // nothing changed → no echo
      lastSynced.current = serialized;
      api.putWorkspaces(blob).catch(() => {
        /* best-effort; localStorage still holds the layout */
      });
    };

    const unsub = usePanels.subscribe(() => {
      if (!ready.current) return; // wait for the initial pull to baseline
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PUSH_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [token]);

  return null;
}
