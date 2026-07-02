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

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable — banner just reappears next load */
    }
  };

  // Public-demo posture: a richer strip with the two calls to action — this
  // banner IS the demo instance's funnel.
  if (health.demo) {
    return (
      <div className="flex items-center gap-2 border-b border-term-amber/30 bg-term-amber/10 px-3 py-1 text-2xs">
        <span className="rounded-sm bg-term-amber/20 px-1.5 py-0.5 font-semibold text-term-amber">PUBLIC DEMO</span>
        <span className="text-term-text">
          Synthetic market — nothing here is real, and nothing can be traded.
          <span className="sm:hidden"> Keyboard-first terminal — best on a desktop.</span>
        </span>
        <a
          href="https://github.com/ayyitskevin/midas#quickstart"
          target="_blank"
          rel="noreferrer"
          className="no-drag text-term-amber hover:underline"
        >
          Deploy your own in 60s →
        </a>
        <a
          href="https://github.com/ayyitskevin/midas#hosted-midas--20month-flat"
          target="_blank"
          rel="noreferrer"
          className="no-drag hidden text-term-amber hover:underline sm:inline"
        >
          Hosted waitlist →
        </a>
        <button onClick={dismiss} title="Dismiss" aria-label="Dismiss demo banner" className="no-drag ml-auto text-term-amber hover:text-term-text">
          ✕
        </button>
      </div>
    );
  }

  const banner = demoBanner(health.provider, health.live);
  if (!banner) return null;

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
