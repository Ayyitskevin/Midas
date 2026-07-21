import { useEffect, useState } from 'react';
import { usePanels } from '@/store/usePanels';
import { useAuth } from '@/store/useAuth';
import { useHotkeyHelp } from '@/store/useHotkeyHelp';
import { stream, useStreamStatus } from '@/lib/stream';
import { streamStatusView } from '@/lib/streamStatus';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { sourceView } from '@/lib/sourceStatus';
import { useTradingStatus } from '@/lib/useTradingStatus';

/** UTC wall clock — crypto settles on UTC (funding, daily candles, cap resets). */
function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return (
    <span className="tabular-nums text-term-muted" title="UTC — funding, daily candles and caps roll on this clock">
      {hh}:{mm}:{ss} UTC
    </span>
  );
}

export function StatusBar() {
  const panelCount = usePanels((s) => s.panels.length);
  const reset = usePanels((s) => s.resetWorkspace);
  const toggleHelp = useHotkeyHelp((s) => s.toggle);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.clear);
  const status = useStreamStatus();
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const { data: health } = useFetch(
    async (signal) => {
      const t0 = performance.now();
      const h = await api.health(signal);
      setLatencyMs(Math.round(performance.now() - t0));
      return h;
    },
    [],
    { intervalMs: 30000 },
  );
  const src = health ? sourceView(health.provider, health.live) : null;
  // streamLive (from health): false → SIM; true → LIVE; unknown (health not
  // loaded) → OPEN without LIVE so a mock/yahoo session never flashes LIVE.
  const conn = streamStatusView(status, stream.subscriberCount(), health?.streamLive ?? null);
  const trading = useTradingStatus();

  return (
    <div className="flex items-center justify-between border-t border-term-border bg-term-header px-3 py-1 text-2xs text-term-muted">
      <div className="flex items-center gap-3">
        <span className="text-term-amber">MIDAS</span>
        {health && <span className="text-term-dim">v{health.version}</span>}
        <span>
          {panelCount} panel{panelCount === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1" title={conn.title}>
          <span className={conn.dotClass}>●</span>
          <span className="hidden sm:inline">{conn.label}</span>
        </span>
        {src && (
          <span className="flex items-center gap-1" title={src.title}>
            <span className={src.dotClass}>●</span>
            <span className="hidden sm:inline">
              {src.label}
              {src.tone === 'synthetic' && <span className="text-term-amber"> · synthetic</span>}
            </span>
          </span>
        )}
        {/* Defensive legacy state: current servers always report the safety hold. */}
        {trading?.enabled && (
          <span className="flex items-center gap-1 font-semibold text-term-down" title={trading.reason}>
            <span>●</span>
            <span>LIVE TRADING</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {latencyMs != null && (
          <span
            className={`hidden tabular-nums sm:inline ${latencyMs > 500 ? 'text-term-amber' : 'text-term-dim'}`}
            title="API round-trip (health poll)"
          >
            {latencyMs}ms
          </span>
        )}
        <UtcClock />
        <span className="hidden md:inline">
          type a ticker then <span className="text-term-text">DES · GP · N</span> — or{' '}
          <span className="text-term-text">HELP</span>
        </span>
        <button
          onClick={toggleHelp}
          className="hidden transition-colors hover:text-term-text sm:inline"
          title="Keyboard shortcuts (press ?)"
        >
          ⌨ keys
        </button>
        <button onClick={reset} className="transition-colors hover:text-term-down" title="Close all panels">
          RESET
        </button>
        {user && (
          <span className="flex items-center gap-1.5">
            <span className="text-term-text">{user.username}</span>
            <button onClick={logout} className="transition-colors hover:text-term-down" title="Log out">
              logout
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
