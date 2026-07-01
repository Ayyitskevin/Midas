import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { Loading, ErrorMsg } from '@/components/Feedback';

function fmtUptime(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Row({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-term-border/20 px-2 py-1">
      <span className="text-2xs text-term-dim">{label}</span>
      <span className={`font-mono text-2xs ${on == null ? 'text-term-text' : on ? 'text-term-up' : 'text-term-dim'}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * SYS — the server's operational self-description: provider, version, uptime,
 * and which background loops are actually running (watcher, stream nudge,
 * digest, equity snapshots, trading gate). The honest answer to "is it on?"
 * without reading server logs — for self-hosters debugging a setup and for
 * hosted-tier support alike.
 */
export function SysModule() {
  const { data, error, loading, refresh } = useFetch((signal) => api.system(signal), [], {
    intervalMs: 30_000,
  });

  if (loading && !data) return <Loading label="Loading system status" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data) return null;

  const ms = (v: number | null): string => (v == null ? 'off' : v >= 60_000 ? `${Math.round(v / 60_000)}m` : `${Math.round(v / 1000)}s`);

  return (
    <div className="scroll-term h-full overflow-y-auto">
      <Row label="Provider" value={`${data.provider} (${data.live ? 'live' : 'synthetic'})`} on={data.live} />
      <Row label="Version" value={`v${data.version}`} />
      <Row label="Uptime" value={fmtUptime(data.startedAt)} />
      {data.demo && <Row label="Demo mode" value="PUBLIC DEMO — trading & signups disabled" on={false} />}
      <Row
        label="Account watcher"
        value={data.accountWatch.on ? `on · every ${ms(data.accountWatch.intervalMs)}` : 'off'}
        on={data.accountWatch.on}
      />
      <Row label="Stream nudge (ccxt.pro)" value={data.streamNudge ? 'active' : 'off'} on={data.streamNudge} />
      <Row
        label="Operator digest"
        value={data.digest.on ? `on · every ${data.digest.hours}h` : 'off'}
        on={data.digest.on}
      />
      <Row
        label="Equity snapshots"
        value={data.equity.on ? `on · every ${ms(data.equity.intervalMs)}` : 'off'}
        on={data.equity.on}
      />
      <Row label="Live trading" value={data.tradingEnabled ? 'ENABLED' : 'off (read-only)'} on={data.tradingEnabled} />
      <Row label="Auth" value={data.authEnabled ? 'required' : 'off (single-user)'} on={data.authEnabled} />
      <p className="px-2 py-2 text-2xs leading-relaxed text-term-dim">
        Off states are configuration, not failures — each loop starts when its env var and prerequisites (keys, live
        provider, webhook) are set. See the README's configuration table.
      </p>
    </div>
  );
}
