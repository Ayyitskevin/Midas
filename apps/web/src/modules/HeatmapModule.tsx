import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtSignedPercent } from '@/lib/format';
import { treemap, heatColor } from '@/lib/heatmap';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const QUOTES = ['USDT', 'BTC'];

export function HeatmapModule({ panel }: ModuleProps) {
  const [quote, setQuote] = useState('USDT');
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.screener(quote, 'volume', 100, signal),
    [quote],
    { intervalMs: 15_000 },
  );

  // Measure the tile area so the treemap can lay out in real pixels.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = data ?? [];
  const byKey = useMemo(() => {
    const m = new Map<string, (typeof rows)[number]>();
    for (const r of rows) m.set(r.symbol, r);
    return m;
  }, [rows]);

  const tiles = useMemo(
    () =>
      treemap(
        rows.map((r) => ({ key: r.symbol, value: r.quoteVolume ?? r.volume ?? 0 })),
        size.w,
        size.h,
      ),
    [rows, size],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">size = 24h vol · color = 24h %</span>
        <div className="ml-auto flex gap-1">
          {QUOTES.map((qc) => (
            <button
              key={qc}
              onClick={() => setQuote(qc)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                quote === qc ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {qc}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Loading markets" />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
        {data && data.length === 0 && <EmptyState>No {quote} markets.</EmptyState>}

        <div ref={wrapRef} className="absolute inset-0">
          {tiles.map((t) => {
            const row = byKey.get(t.key);
            if (!row) return null;
            const showSym = t.w > 40 && t.h > 18;
            const showChg = t.w > 40 && t.h > 32;
            return (
              <button
                key={t.key}
                onClick={() => navigate(panel, t.key)}
                title={`${t.key}  ${fmtSignedPercent(row.changePercent)}`}
                className="no-drag absolute overflow-hidden border border-term-bg text-left hover:border-term-amber"
                style={{
                  left: t.x,
                  top: t.y,
                  width: t.w,
                  height: t.h,
                  backgroundColor: heatColor(row.changePercent),
                }}
              >
                {showSym && (
                  <div className="px-1 pt-0.5 text-2xs font-semibold leading-tight text-term-text">
                    {t.key.replace(/\/.*$/, '')}
                  </div>
                )}
                {showChg && (
                  <div className="px-1 text-2xs leading-tight text-term-text/80">
                    {fmtSignedPercent(row.changePercent)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
