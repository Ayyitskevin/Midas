import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { summarizeFunding } from '@/lib/fundingHistory';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const pctRate = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(4)}%`);
const pctApr = (a: number | null) => (a == null ? '—' : `${a >= 0 ? '+' : '−'}${Math.abs(a).toFixed(1)}%`);
const aprClass = (a: number | null) =>
  a == null || a === 0 ? 'text-term-text' : a > 0 ? 'text-term-up' : 'text-term-down';

export function FundingHistoryModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.fundingHistory(symbol!, 90, signal),
    [symbol],
    { intervalMs: 60_000, enabled: !!symbol },
  );

  const rated = useMemo(
    () => (data ?? []).filter((p) => p.fundingRate != null && Number.isFinite(p.fundingRate)),
    [data],
  );
  const summary = useMemo(() => summarizeFunding(data ?? []), [data]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = useMemo(() => {
    if (rated.length === 0 || size.w <= 0 || size.h <= 0) return null;
    const maxAbs = Math.max(1e-12, ...rated.map((p) => Math.abs(p.fundingRate as number)));
    const barW = size.w / rated.length;
    const mid = size.h / 2;
    return rated.map((p, i) => {
      const r = p.fundingRate as number;
      const h = (Math.abs(r) / maxAbs) * (mid - 1);
      const up = r >= 0;
      return (
        <rect
          key={i}
          x={i * barW + barW * 0.1}
          y={up ? mid - h : mid}
          width={Math.max(0.6, barW * 0.8)}
          height={Math.max(0, h)}
          fill={up ? 'rgba(38,194,129,0.75)' : 'rgba(239,77,86,0.75)'}
        />
      );
    });
  }, [rated, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} funding`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (summary.count === 0) return <EmptyState>No funding history for {symbol}.</EmptyState>;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">funding history · {summary.count} settlements (8h)</span>
        <span className="ml-auto tabular-nums">
          <span className="text-term-muted">now </span>
          <span className={aprClass(summary.currentApr)}>
            {pctRate(summary.current)} · {pctApr(summary.currentApr)} APR
          </span>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 p-2 tabular-nums">
        <div className="flex flex-col">
          <span className="text-term-dim">AVG APR</span>
          <span className={aprClass(summary.averageApr)}>{pctApr(summary.averageApr)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-term-dim">% POSITIVE</span>
          <span className="text-term-text">{(summary.positiveShare * 100).toFixed(0)}%</span>
        </div>
        <div className="flex flex-col">
          <span className="text-term-dim">MIN</span>
          <span className="text-term-down">{pctRate(summary.min)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-term-dim">MAX</span>
          <span className="text-term-up">{pctRate(summary.max)}</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 px-2 pb-1">
        <div ref={wrapRef} className="absolute inset-0 px-2 pb-1">
          {bars && (
            <svg width={size.w} height={size.h} className="block">
              <line x1={0} x2={size.w} y1={size.h / 2} y2={size.h / 2} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              {bars}
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Funding paid each 8h settlement (oldest → newest) · green = longs pay (positive), red = shorts pay
      </div>
    </div>
  );
}
