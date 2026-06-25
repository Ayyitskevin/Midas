import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { toReturns } from '@/lib/correlation';
import { volTerm, type VolRegime } from '@/lib/volTerm';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const LOOKBACKS = [7, 14, 30, 60, 90, 180];
const PERIODS_PER_YEAR = 365;

const REGIME: Record<VolRegime, { label: string; rgb: string; note: string }> = {
  elevated: { label: 'ELEVATED', rgb: '255,176,0', note: 'near-term vol rich vs the long end' },
  compressed: { label: 'COMPRESSED', rgb: '76,194,255', note: 'near-term vol cheap vs the long end' },
  flat: { label: 'FLAT', rgb: '122,127,135', note: 'roughly level across horizons' },
};

export function VolTermModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, '1d', '1y', signal),
    [symbol],
    { enabled: !!symbol },
  );

  const term = useMemo(() => {
    if (!data) return null;
    const returns = toReturns(data.candles.map((c) => c.close));
    return volTerm(returns, LOOKBACKS, PERIODS_PER_YEAR);
  }, [data]);

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

  const chart = useMemo(() => {
    if (!term || term.points.length < 2 || size.w <= 0 || size.h <= 0) return null;
    const pts = term.points;
    const vols = pts.map((p) => p.vol);
    const lo = Math.min(...vols);
    const hi = Math.max(...vols);
    const span = hi - lo || 1;
    const padX = 8;
    const padTop = 16;
    const padBot = 16;
    const pw = size.w - padX * 2;
    const ph = size.h - padTop - padBot;
    const xAt = (i: number) => padX + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw);
    const yAt = (v: number) => padTop + (1 - (v - lo) / span) * ph;
    const line = pts.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.vol).toFixed(1)}`).join(' ');
    return { pts, xAt, yAt, line, bottom: padTop + ph };
  }, [term, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!term || term.points.length < 2) return <EmptyState>Not enough history for a term structure.</EmptyState>;

  const reg = REGIME[term.regime];
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">realized vol term structure · annualized</span>
        <span
          className="ml-auto rounded-sm border px-1.5 py-0.5 font-semibold uppercase"
          style={{ color: `rgb(${reg.rgb})`, borderColor: `rgba(${reg.rgb},0.5)` }}
        >
          {reg.label}
        </span>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">
          {term.points[0].lookbackDays}d <span className="text-term-text">{pct(term.shortVol)}</span>
        </span>
        <span className="text-term-muted">
          {term.points[term.points.length - 1].lookbackDays}d{' '}
          <span className="text-term-text">{pct(term.longVol)}</span>
        </span>
        {term.ratio != null && (
          <span className="text-term-dim">ratio {term.ratio.toFixed(2)}× · {reg.note}</span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {chart && (
            <svg width={size.w} height={size.h} className="block">
              <polyline points={chart.line} fill="none" stroke={`rgba(${reg.rgb},0.9)`} strokeWidth={1.5} />
              {chart.pts.map((p, i) => (
                <g key={p.lookbackDays}>
                  <circle cx={chart.xAt(i)} cy={chart.yAt(p.vol)} r={2.5} fill={`rgb(${reg.rgb})`} />
                  <text
                    x={chart.xAt(i)}
                    y={chart.yAt(p.vol) - 5}
                    textAnchor="middle"
                    className="text-term-text"
                    fill="currentColor"
                    style={{ fontSize: 8 }}
                  >
                    {(p.vol * 100).toFixed(0)}
                  </text>
                  <text
                    x={chart.xAt(i)}
                    y={chart.bottom + 11}
                    textAnchor="middle"
                    className="text-term-dim"
                    fill="currentColor"
                    style={{ fontSize: 8 }}
                  >
                    {p.lookbackDays}d
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Realized vol = stdev of daily returns over each window, annualized √365 · short/long ratio sets the regime
      </div>
    </div>
  );
}
