import { useEffect, useRef } from 'react';

/** Wait this long after the last local change before pushing to the server. */
const PUSH_DEBOUNCE_MS = 1500;

export interface ServerSyncConfig {
  /** Current auth token; sync is completely inert when null. */
  token: string | null;
  /** Pull the stored snapshot for the signed-in user. */
  pull: () => Promise<{ snapshot: { blob: unknown } | null }>;
  /** Push the local snapshot blob to the server. */
  push: (blob: unknown) => Promise<unknown>;
  /** Capture the local store's current syncable slice. */
  snapshot: () => unknown;
  /** Replace the local store from a server blob (coercing/ignoring bad input). */
  restore: (blob: unknown) => void;
  /** Subscribe to local store changes; returns an unsubscribe fn. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Generic per-user server sync: pull the snapshot on login, then push a
 * debounced, content-guarded snapshot whenever the local store changes. A
 * freshly-pulled snapshot never echoes straight back, and with no token the
 * hook does nothing — single-user keeps relying on localStorage. Shared by the
 * workspace and portfolio sync components.
 */
export function useServerSync(cfg: ServerSyncConfig): void {
  const { token } = cfg;
  // Keep the latest config in a ref so the effects depend only on `token`
  // (the callbacks are recreated each render but are functionally stable).
  const ref = useRef(cfg);
  ref.current = cfg;

  // Serialized form of the last snapshot we synced — the echo/no-op guard.
  const lastSynced = useRef<string | null>(null);
  // True once the initial pull has baselined `lastSynced`.
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
      lastSynced.current = JSON.stringify(ref.current.snapshot());
      ready.current = true;
    };

    ref.current
      .pull()
      .then((res) => {
        if (cancelled) return;
        if (res.snapshot) ref.current.restore(res.snapshot.blob);
        baseline();
      })
      .catch(() => {
        // Offline / transient — keep local state but still allow this device to
        // push once it changes, baselined to the current local state.
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
      const blob = ref.current.snapshot();
      const serialized = JSON.stringify(blob);
      if (serialized === lastSynced.current) return; // nothing changed → no echo
      lastSynced.current = serialized;
      ref.current.push(blob).catch(() => {
        /* best-effort; localStorage still holds the state */
      });
    };

    const unsub = ref.current.subscribe(() => {
      if (!ready.current) return; // wait for the initial pull to baseline
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PUSH_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [token]);
}
