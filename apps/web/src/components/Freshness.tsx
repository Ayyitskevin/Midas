import { useEffect, useState } from 'react';
import { freshnessView } from '@/lib/freshness';

interface FreshnessAgeProps {
  /** Epoch ms of the panel's last update (REST success or stream message); null = hidden. */
  fetchedAt: number | null;
  /** Age (ms) beyond which the data reads stale — per panel, ~2x its refresh cadence. */
  staleAfterMs: number;
  /** Stream state for stream-driven panels: false marks the age stale (socket
   * down while showing stream data); undefined = not stream-driven (REST-only). */
  streamLive?: boolean;
}

/**
 * Per-panel last-update age: a quiet dot + '12s'/'3m' label in the BoardMetaBadge
 * idiom. Self-ticking (its own 1s timer) so the parent panel doesn't re-render
 * every second. Turns amber when the data is stale or the driving stream is
 * down — the data itself is never hidden, only honestly aged.
 */
export function FreshnessAge({ fetchedAt, staleAfterMs, streamLive }: FreshnessAgeProps) {
  // Local 1s tick; only this span re-renders, not the panel tree.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (fetchedAt == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  const v = freshnessView({ fetchedAt, staleAfterMs, streamDisconnected: streamLive === false });
  if (v.text == null) return null;

  const title =
    streamLive === false
      ? `Stream disconnected — last update ${v.text} ago`
      : `Last update ${v.text} ago`;
  return (
    <span
      className={`flex items-center gap-1 text-2xs ${v.stale ? 'text-term-amber' : 'text-term-dim'}`}
      title={title}
    >
      <span className={`inline-block h-1 w-1 rounded-full ${v.stale ? 'bg-term-amber' : 'bg-term-dim'}`} />
      <span className="tabular-nums">{v.text}</span>
    </span>
  );
}
