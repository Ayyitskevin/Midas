import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePanels } from '@/store/usePanels';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { bollinger, ema, rsi, sma, type LinePoint } from '@/lib/indicators';
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

const UP = '#26c281';
const DOWN = '#ef4d56';

export function ChartModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const interval = (panel.params?.interval as Interval) ?? '1d';
  const range = (panel.params?.range as Range) ?? '6mo';
  const setPanelParams = usePanels((s) => s.setPanelParams);

  const { data, error, loading } = useFetch(
    (signal) => api.history(symbol as string, interval, range, signal),
    [symbol, interval, range],
    { enabled: Boolean(symbol) },
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [ind, setInd] = useState({ sma: true, ema: false, bb: false, rsi: false });

  // Create the chart once, on mount.
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

    const candle = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // Push new data into the series whenever it changes.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candle || !volume || !chart || !data) return;

    candle.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volume.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,194,129,0.35)' : 'rgba(239,77,86,0.35)',
      })),
    );
    chart.timeScale().fitContent();
  }, [data]);

  // Indicator overlays — rebuilt when data or the enabled studies change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data) return;

    for (const s of indicatorSeriesRef.current) chart.removeSeries(s);
    indicatorSeriesRef.current = [];

    const addLine = (points: LinePoint[], color: string) => {
      const series = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      indicatorSeriesRef.current.push(series);
    };

    if (ind.sma) addLine(sma(data.candles, 20), '#ffb000');
    if (ind.ema) addLine(ema(data.candles, 50), '#4cc2ff');
    if (ind.bb) {
      const bands = bollinger(data.candles, 20, 2);
      addLine(bands.upper, 'rgba(122,127,135,0.8)');
      addLine(bands.lower, 'rgba(122,127,135,0.8)');
      addLine(bands.middle, 'rgba(122,127,135,0.4)');
    }
  }, [data, ind]);

  // RSI oscillator sub-pane: a second chart that follows the main chart's time scale.
  useEffect(() => {
    if (!ind.rsi) {
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
      return;
    }
    const el = rsiContainerRef.current;
    if (!el) return;
    const main = chartRef.current;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7a7f87',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderColor: '#26262d' },
      timeScale: { borderColor: '#26262d', visible: false },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addLineSeries({
      color: '#c08cff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    series.createPriceLine({ price: 70, color: 'rgba(239,77,86,0.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
    series.createPriceLine({ price: 30, color: 'rgba(38,194,129,0.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });
    rsiChartRef.current = chart;
    rsiSeriesRef.current = series;

    let sync: ((r: LogicalRange | null) => void) | null = null;
    if (main) {
      sync = (r) => {
        if (r) chart.timeScale().setVisibleLogicalRange(r);
      };
      main.timeScale().subscribeVisibleLogicalRangeChange(sync);
      const current = main.timeScale().getVisibleLogicalRange();
      if (current) chart.timeScale().setVisibleLogicalRange(current);
    }

    return () => {
      if (main && sync) main.timeScale().unsubscribeVisibleLogicalRangeChange(sync);
      chart.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    };
  }, [ind.rsi]);

  // Feed the RSI series.
  useEffect(() => {
    const series = rsiSeriesRef.current;
    if (!series || !data) return;
    series.setData(
      rsi(data.candles, 14).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
  }, [data, ind.rsi]);

  const perf = useMemo(() => {
    if (!data || data.candles.length < 2) return null;
    const first = data.candles[0].close;
    const last = data.candles[data.candles.length - 1].close;
    return { last, changePct: first === 0 ? 0 : ((last - first) / first) * 100 };
  }, [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-amber">{symbol}</span>
          {perf && <span className="text-xs tabular-nums">{fmtPrice(perf.last)}</span>}
          {perf && (
            <span className={`text-2xs tabular-nums ${changeClass(perf.changePct)}`}>
              {fmtSignedPercent(perf.changePct)} <span className="text-term-dim">{range}</span>
            </span>
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
      <div className="no-drag flex items-center gap-1 border-b border-term-border px-2 py-0.5 text-2xs">
        <span className="mr-1 text-term-dim">studies</span>
        {([
          ['sma', 'SMA 20'],
          ['ema', 'EMA 50'],
          ['bb', 'BB 20'],
          ['rsi', 'RSI 14'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setInd((p) => ({ ...p, [key]: !p[key] }))}
            className={`rounded-sm px-1.5 py-0.5 ${
              ind[key] ? 'text-term-amber' : 'text-term-muted hover:text-term-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label={`Loading ${symbol}`} />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} />
          </div>
        )}
      </div>
      {ind.rsi && (
        <div className="relative h-20 shrink-0 border-t border-term-border">
          <div className="absolute left-1 top-0.5 z-10 text-2xs text-term-dim">RSI 14</div>
          <div ref={rsiContainerRef} className="absolute inset-0" />
        </div>
      )}
    </div>
  );
}
