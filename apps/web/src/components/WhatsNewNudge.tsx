import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useToasts } from '@/store/useToasts';
import { isNewerVersion } from '@/lib/whatsNew';

const SEEN_KEY = 'midas-seen-version';

/**
 * One-time "Midas updated" announcement. On load, compare the SERVER's
 * version against the last one this browser saw: newer → a single info toast
 * pointing at WN, then remember. First contact just baselines (no toast) —
 * a brand-new user shouldn't be greeted with an upgrade banner.
 */
export function WhatsNewNudge() {
  useEffect(() => {
    const controller = new AbortController();
    api
      .health(controller.signal)
      .then((h) => {
        if (!h.version) return;
        const seen = localStorage.getItem(SEEN_KEY);
        if (isNewerVersion(h.version, seen)) {
          useToasts.getState().push({
            title: `Midas updated to v${h.version}`,
            body: "Type WN to see what's new.",
            tone: 'info',
          });
        }
        localStorage.setItem(SEEN_KEY, h.version);
      })
      .catch(() => {
        /* health unavailable — try again next load */
      });
    return () => controller.abort();
  }, []);

  return null;
}
