import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { coinBadge, sortCoins, type CoinSortKey } from '@/lib/coins';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

/** Magnitude-aware USD price — keeps sub-cent memecoins from rounding to zero. */
function fmtCoinPrice(p: number | null): string {
  if (p == null) return '—';
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toPrecision(2)}`;
}

/** Signed 24h change percent. */
function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Large USD figure (market cap / FDV) as a compact string, or an em dash. */
function fmtUsd(v: number | null): string {
  return v != null ? `$${fmtCompact(v)}` : '—';
}

const BADGE_TONE: Record<'live' | 'demo' | 'off', string> = {
  live: 'border border-term-up/50 text-term-up',
  demo: 'border border-term-amber/50 text-term-amber',
  off: 'border border-term-border text-term-dim',
};

export function TopCoinsModule({ panel }: ModuleProps) {
  const [sortKey, setSortKey] = useState<CoinSortKey>('rank');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const { data, error, loading, refresh } = useFetch((signal) => api.coins(100, signal), [], {
    intervalMs: 30_000,
  });

  const rows = useMemo(() => (data ? sortCoins(data.coins, sortKey, dir) : []), [data, sortKey, dir]);

  const sortBy = (key: CoinSortKey) => {
    if (key === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      // Rank reads best ascending (1 first); every other column starts descending.
      setDir(key === 'rank' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: CoinSortKey) => (key === sortKey ? (dir === 'desc' ? ' ▾' : ' ▴') : '');
  const th = (key: CoinSortKey | null, label: string, align: string) => (
    <th className={`px-2 py-1 font-normal ${align}`}>
      {key ? (
        <button className="no-drag hover:text-term-text" onClick={() => sortBy(key)}>
          {label}
          {arrow(key)}
        </button>
      ) : (
        label
      )}
    </th>
  );

  const badge = data ? coinBadge(data.provenance) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">TOP COINS</span>
        <span className="flex items-center gap-2 text-term-dim">
          <span>by market cap</span>
          {badge && (
            <span className={`rounded-sm px-1.5 py-0.5 font-semibold ${BADGE_TONE[badge.tone]}`} title={data?.note ?? undefined}>
              {badge.label}
            </span>
          )}
        </span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading coins" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && data.provenance === 'unavailable' && (
          <EmptyState>{data.note ?? 'No market-cap reference source is configured for this provider.'}</EmptyState>
        )}
        {data && data.provenance !== 'unavailable' && rows.length === 0 && (
          <EmptyState>No coins available.</EmptyState>
        )}
        {rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                {th('rank', '#', 'text-right')}
                {th(null, 'COIN', 'text-left')}
                {th('price', 'PRICE', 'text-right')}
                {th('change', '24H', 'text-right')}
                {th('marketCap', 'MKT CAP', 'text-right')}
                {th('fdv', 'FDV', 'text-right')}
                {th('supply', 'SUPPLY', 'text-right')}
                {th(null, 'CAT', 'text-left')}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.base} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{c.rank}</td>
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, `${c.base}/USDT`)}
                      title={c.name}
                    >
                      {c.base}
                    </button>
                    <span className="ml-1 text-term-dim">{c.name}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtCoinPrice(c.priceUsd)}</td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${
                      (c.change24hPct ?? 0) >= 0 ? 'text-term-up' : 'text-term-down'
                    }`}
                  >
                    {fmtPct(c.change24hPct)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtUsd(c.marketCapUsd)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtUsd(c.fdvUsd)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    {c.circulatingSupply != null ? `${fmtCompact(c.circulatingSupply)} ${c.base}` : '—'}
                  </td>
                  <td className="px-2 py-1 text-left text-term-dim">{c.category ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
