import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePanels } from '@/store/usePanels';
import { changeClass, fmtSignedPercent } from '@/lib/format';
import { combineSeries, type RatioMode } from '@/lib/ratio';
import { replaceRatioChartSeries } from '@/lib/chartSeries';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

interface Preset {
  label: string;
  interval: Interval;
  range: Range;
}

const PRESETS: Preset[] = [
  { label: '1D', interval: '5m', range: '1d' },
  { label: '5D', interval: '30m', range: '5d' },
  { label: '1M', interval: '1d', range: '1mo' },
  { label: '6M', interval: '1d', range: '6mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '5Y', interval: '1wk', range: '5y' },
];

/** Decimals to display, scaled to the series' magnitude. */
function precisionFor(maxAbs: number): number {
  if (maxAbs >= 100) return 2;
  if (maxAbs >= 1) return 4;
  return 6;
}

export function RatioModule({ panel }: ModuleProps) {
  const setPanelParams = usePanels((s) => s.setPanelParams);
  const interval = (panel.params?.interval as Interval) ?? '1d';
  const range = (panel.params?.range as Range) ?? '6mo';

  const [num, setNum] = useState(() =>
    ((panel.params?.num as string) ?? panel.symbol ?? 'ETH/USDT').toUpperCase(),
  );
  const [den, setDen] = useState(() => ((panel.params?.den as string) ?? 'BTC/USDT').toUpperCase());
  const [mode, setMode] = useState<RatioMode>(() => (panel.params?.mode as RatioMode) ?? 'ratio');
  const [numInput, setNumInput] = useState(num);
  const [denInput, setDenInput] = useState(den);

  // Persist the pair + mode so the workspace (and server sync) remembers it.
  useEffect(() => {
    setPanelParams(panel.id, { num, den, mode });
  }, [num, den, mode, panel.id, setPanelParams]);

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const [a, b] = await Promise.all([
        api.history(num, interval, range, signal),
        api.history(den, interval, range, signal),
      ]);
      return { a: a.candles, b: b.candles };
    },
    [num, den, interval, range],
    { enabled: Boolean(num && den) },
  );

  const points = useMemo(() => (data ? combineSeries(data.a, data.b, mode) : []), [data, mode]);
  const precision = useMemo(
    () => precisionFor(points.reduce((m, p) => Math.max(m, Math.abs(p.value)), 0)),
    [points],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7a7f87',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: '#26262d' },
      timeScale: { borderColor: '#26262d', timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // (Re)build the single line whenever the data, mode, or precision changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = seriesRef.current;
    seriesRef.current = null;
    seriesRef.current = replaceRatioChartSeries(
      chart,
      current,
      points,
      precision,
    );
  }, [points, precision]);

  const stats = useMemo(() => {
    if (points.length < 1) return null;
    const last = points[points.length - 1].value;
    const first = points[0].value;
    const changePct = first !== 0 ? ((last - first) / first) * 100 : null;
    return { last, changePct };
  }, [points]);

  const op = mode === 'ratio' ? '÷' : '−';
  const commit = () => {
    const n = numInput.trim().toUpperCase();
    const d = denInput.trim().toUpperCase();
    if (n) setNum(n);
    if (d) setDen(d);
  };
  const swap = () => {
    setNum(den);
    setDen(num);
    setNumInput(den);
    setDenInput(num);
  };
  const inputCls =
    'w-24 rounded-sm border border-term-border bg-transparent px-1.5 py-0.5 text-xs uppercase text-term-text outline-none focus:border-term-amber';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-amber">
            {num} {op} {den}
          </span>
          {stats && (
            <>
              <span className="text-xs tabular-nums">{stats.last.toFixed(precision)}</span>
              {stats.changePct != null && (
                <span className={`text-2xs tabular-nums ${changeClass(stats.changePct)}`}>
                  {fmtSignedPercent(stats.changePct)} <span className="text-term-dim">{range}</span>
                </span>
              )}
            </>
          )}
        </div>
        <div className="no-drag flex gap-0.5">
          {PRESETS.map((p) => {
            const active = p.interval === interval && p.range === range;
            return (
              <button
                key={p.label}
                onClick={() => setPanelParams(panel.id, { interval: p.interval, range: p.range })}
                className={`rounded-sm border px-1.5 py-0.5 text-2xs transition-colors ${
                  active
                    ? 'border-term-amber text-term-amber'
                    : 'border-transparent text-term-muted hover:text-term-text'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="no-drag flex items-center gap-1 border-b border-term-border px-2 py-1 text-2xs">
        <input
          value={numInput}
          onChange={(e) => setNumInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          onBlur={commit}
          placeholder="ETH/USDT"
          className={inputCls}
        />
        <button onClick={swap} title="Swap" className="px-1 text-term-muted hover:text-term-amber">
          ⇄
        </button>
        <input
          value={denInput}
          onChange={(e) => setDenInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          onBlur={commit}
          placeholder="BTC/USDT"
          className={inputCls}
        />
        <span className="ml-auto flex gap-0.5">
          {(['ratio', 'spread'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-sm px-1.5 py-0.5 ${
                mode === m ? 'text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {m}
            </button>
          ))}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Loading pair" />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
        {data && points.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState>No overlapping history for {num} and {den}.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
