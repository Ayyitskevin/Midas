import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { demoBanner } from '@/lib/sourceStatus';

const DISMISS_KEY = 'midas-demo-banner-dismissed';

/**
 * A dismissible, honest "you're on demo data" strip shown at the top of the app
 * when the active provider is synthetic. Lowers first-run confusion (the default
 * mock feed isn't real markets) and points the way to live data. Reuses the
 * /api/health check; hidden entirely once a live provider is configured.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const { data: health } = useFetch((signal) => api.health(signal), [], { intervalMs: 60_000 });

  if (dismissed || !health) return null;
  const banner = demoBanner(health.provider, health.live);
  if (!banner) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable — banner just reappears next load */
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-term-amber/30 bg-term-amber/10 px-3 py-1 text-2xs">
      <span className="rounded-sm bg-term-amber/20 px-1.5 py-0.5 font-semibold text-term-amber">DEMO</span>
      <span className="text-term-text">{banner.text}</span>
      <span className="hidden text-term-dim sm:inline">{banner.hint}</span>
      <button
        onClick={dismiss}
        title="Dismiss"
        className="no-drag ml-auto text-term-amber hover:text-term-text"
      >
        ✕
      </button>
    </div>
  );
}
