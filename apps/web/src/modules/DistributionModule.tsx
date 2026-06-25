import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { toReturns } from '@/lib/correlation';
import { histogram, returnStats } from '@/lib/distribution';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const NBINS = 27;
const ANNUAL = Math.sqrt(365);

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];
const CONFS = [0.95, 0.99];

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col rounded-sm border border-term-border bg-term-panel/60 px-2 py-1">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function DistributionModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(1); // default 1Y
  const [conf, setConf] = useState(0.95);
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, tf.interval, tf.range, signal),
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const returns = useMemo(() => (data ? toReturns(data.candles.map((c) => c.close)) : []), [data]);
  const stats = useMemo(() => (returns.length >= 2 ? returnStats(returns, conf) : null), [returns, conf]);
  const bins = useMemo(() => (returns.length >= 2 ? histogram(returns, NBINS) : []), [returns]);

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
    if (!stats || bins.length === 0 || size.w <= 0 || size.h <= 0) return null;
    const lo = bins[0].start;
    const hi = bins[bins.length - 1].end;
    const span = hi - lo || 1;
    const maxCount = Math.max(1, ...bins.map((b) => b.count));
    const padB = 12;
    const plotH = size.h - padB;
    const barW = size.w / bins.length;
    const xFor = (v: number) => ((v - lo) / span) * size.w;
    const yFor = (c: number) => plotH - (c / maxCount) * (plotH - 2);
    const varX = xFor(-stats.var);
    return { lo, hi, maxCount, plotH, barW, xFor, yFor, varX };
  }, [stats, bins, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!stats) return <EmptyState>Not enough history for {symbol}.</EmptyState>;

  const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
  const confLabel = `${Math.round(conf * 100)}%`;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">daily return distribution · {stats.n} obs</span>
        <div className="ml-auto flex items-center gap-1">
          {CONFS.map((c) => (
            <button
              key={c}
              onClick={() => setConf(c)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                conf === c ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {Math.round(c * 100)}%
            </button>
          ))}
          <span className="mx-1 text-term-border">|</span>
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-6">
        <Stat label={`VaR ${confLabel}`} value={pct(stats.var)} accent="text-term-down" />
        <Stat label={`ES ${confLabel}`} value={pct(stats.es)} accent="text-term-down" />
        <Stat label="Vol (ann)" value={pct(stats.vol * ANNUAL, 1)} />
        <Stat label="Skew" value={stats.skew.toFixed(2)} accent={stats.skew >= 0 ? 'text-term-up' : 'text-term-down'} />
        <Stat label="Kurt" value={stats.kurtosis.toFixed(2)} />
        <Stat label="Min / Max" value={`${pct(stats.min, 1)} / ${pct(stats.max, 1)}`} />
      </div>

      <div className="relative min-h-0 flex-1 px-2 pb-1">
        <div ref={wrapRef} className="absolute inset-0 px-2 pb-1">
          {chart && (
            <svg width={size.w} height={size.h} className="block">
              {/* tail shading left of the VaR threshold */}
              {chart.varX > 0 && <rect x={0} y={0} width={chart.varX} height={chart.plotH} fill="rgba(239,77,86,0.07)" />}

              {bins.map((b, i) => {
                const h = chart.plotH - chart.yFor(b.count);
                const mid = (b.start + b.end) / 2;
                const inTail = b.end <= -stats.var;
                const color = inTail
                  ? 'rgba(239,77,86,0.85)'
                  : mid < 0
                    ? 'rgba(239,77,86,0.4)'
                    : 'rgba(38,194,129,0.45)';
                return (
                  <rect
                    key={i}
                    x={i * chart.barW + 0.4}
                    y={chart.yFor(b.count)}
                    width={Math.max(0.6, chart.barW - 0.8)}
                    height={Math.max(0, h)}
                    fill={color}
                  />
                );
              })}

              {/* zero, mean, VaR lines */}
              <line x1={chart.xFor(0)} x2={chart.xFor(0)} y1={0} y2={chart.plotH} stroke="rgba(122,127,135,0.5)" strokeWidth={1} />
              <line x1={chart.xFor(stats.mean)} x2={chart.xFor(stats.mean)} y1={0} y2={chart.plotH} stroke="rgba(255,176,0,0.7)" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={chart.varX} x2={chart.varX} y1={0} y2={chart.plotH} stroke="rgba(239,77,86,0.9)" strokeWidth={1} />

              {/* axis labels */}
              <text x={1} y={size.h - 2} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {pct(chart.lo, 1)}
              </text>
              <text x={chart.varX + 2} y={9} fill="rgba(239,77,86,0.9)" style={{ fontSize: 8 }}>
                VaR
              </text>
              <text x={size.w - 1} y={size.h - 2} textAnchor="end" className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {pct(chart.hi, 1)}
              </text>
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Historical VaR — a {Math.round((1 - conf) * 100)}% chance of a daily loss worse than {pct(stats.var)}; ES is the average of that tail.
      </div>
    </div>
  );
}
