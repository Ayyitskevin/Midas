import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { Candle, Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePanels } from '@/store/usePanels';
import { changeClass, fmtSignedPercent } from '@/lib/format';
import { rebasePercent, totalReturnPct } from '@/lib/compare';
import {
  FIXED_SERIES_ORDER_OPTIONS,
  rebuildComparisonChartSeries,
} from '@/lib/chartSeries';
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

/** Distinct line colors, assigned to symbols in order. */
const PALETTE = ['#ffb000', '#4cc2ff', '#26c281', '#ef4d56', '#c08cff', '#ff9f40', '#3ad6d6', '#e056fd'];
const MAX_SYMBOLS = 8;
const DEFAULTS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

/** Seed the compare set from saved params, else the panel symbol + defaults. */
function initialSymbols(panel: ModuleProps['panel']): string[] {
  const saved = panel.params?.symbols;
  if (Array.isArray(saved) && saved.length > 0) return saved.map(String).slice(0, MAX_SYMBOLS);
  const seed = panel.symbol ? [panel.symbol] : [];
  for (const d of DEFAULTS) if (!seed.includes(d)) seed.push(d);
  return seed.slice(0, MAX_SYMBOLS);
}

export function ComparisonModule({ panel }: ModuleProps) {
  const setPanelParams = usePanels((s) => s.setPanelParams);
  const interval = (panel.params?.interval as Interval) ?? '1d';
  const range = (panel.params?.range as Range) ?? '6mo';

  const [symbols, setSymbols] = useState<string[]>(() => initialSymbols(panel));
  const [input, setInput] = useState('');

  // Persist the compare set so the workspace (and server sync) remembers it.
  useEffect(() => {
    setPanelParams(panel.id, { symbols });
  }, [symbols, panel.id, setPanelParams]);

  const { data, error, loading, refresh } = useFetch(
    async (signal) =>
      Promise.all(
        symbols.map(async (s) => {
          try {
            const h = await api.history(s, interval, range, signal);
            return { symbol: s, candles: h.candles };
          } catch {
            return { symbol: s, candles: [] as Candle[] };
          }
        }),
      ),
    [symbols.join(','), interval, range],
    { enabled: symbols.length > 0 },
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      ...FIXED_SERIES_ORDER_OPTIONS,
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
      seriesRef.current = [];
    };
  }, []);

  // Rebuild the rebased lines whenever the data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    const current = seriesRef.current;
    seriesRef.current = [];
    seriesRef.current = rebuildComparisonChartSeries(
      chart,
      current,
      data.map((d, i) => ({
        color: PALETTE[i % PALETTE.length],
        points: rebasePercent(d.candles),
      })),
    );
  }, [data]);

  const legend = useMemo(
    () =>
      (data ?? []).map((d, i) => ({
        symbol: d.symbol,
        color: PALETTE[i % PALETTE.length],
        ret: totalReturnPct(d.candles),
        ok: d.candles.length > 0,
      })),
    [data],
  );

  const addSymbol = () => {
    const s = input.trim().toUpperCase();
    if (s && !symbols.includes(s) && symbols.length < MAX_SYMBOLS) setSymbols([...symbols, s]);
    setInput('');
  };
  const removeSymbol = (s: string) => setSymbols(symbols.filter((x) => x !== s));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <span className="text-sm font-bold text-term-amber">COMPARE</span>
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

      <div className="no-drag flex flex-wrap items-center gap-1 border-b border-term-border px-2 py-1 text-2xs">
        {legend.map((l) => (
          <span
            key={l.symbol}
            className="flex items-center gap-1 rounded-sm bg-term-header/60 px-1.5 py-0.5"
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="font-medium text-term-text">{l.symbol}</span>
            {l.ok ? (
              <span className={`tabular-nums ${changeClass(l.ret)}`}>{fmtSignedPercent(l.ret)}</span>
            ) : (
              <span className="text-term-dim">n/a</span>
            )}
            <button
              className="ml-0.5 text-term-dim hover:text-term-down"
              title={`Remove ${l.symbol}`}
              onClick={() => removeSymbol(l.symbol)}
            >
              ×
            </button>
          </span>
        ))}
        {symbols.length < MAX_SYMBOLS && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSymbol();
            }}
            placeholder="+ add symbol"
            className="w-24 rounded-sm border border-term-border bg-transparent px-1.5 py-0.5 text-2xs text-term-text placeholder:text-term-dim focus:border-term-amber focus:outline-none"
          />
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {symbols.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState>Add symbols to compare.</EmptyState>
          </div>
        )}
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Loading series" />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
