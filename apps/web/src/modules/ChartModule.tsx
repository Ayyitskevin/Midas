import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePanels } from '@/store/usePanels';
import { useAlerts } from '@/store/useAlerts';
import { useDrawings, type Drawing } from '@/store/useDrawings';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { alertOpForLevel, opSymbol } from '@/lib/alerts';
import {
  CHART_DOWN as DOWN,
  CHART_UP as UP,
  FIXED_SERIES_ORDER_OPTIONS,
  addHistogramChartSeries,
  addLineChartSeries,
  createPrimaryChartSeries,
} from '@/lib/chartSeries';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { FreshnessAge } from '@/components/Freshness';
import { SourceBadge } from '@/components/SourceInspector';
import { inspectChartCalculations } from '@/lib/chartTrust';
import { isReceiptActionable } from '@/lib/receiptView';
import { bollinger, ema, fibLevels, macd, rsi, sma, volumeProfile, vwap, type LinePoint } from '@/lib/indicators';
import type { ModuleProps } from './types';

/** The active chart-click tool: arm an alert, or draw a line / trendline / fib. */
type Tool = 'none' | 'alert' | 'hline' | 'trend' | 'fib';

/** Round a clicked price to a sensible threshold precision for its magnitude. */
function roundLevel(price: number): number {
  return price >= 1 ? Math.round(price * 100) / 100 : Math.round(price * 1e6) / 1e6;
}

/** Mirror `main`'s visible range onto a sub-pane chart; returns an unsubscribe. */
function linkTimeScale(main: IChartApi, sub: IChartApi): () => void {
  const sync = (r: LogicalRange | null) => {
    if (r) sub.timeScale().setVisibleLogicalRange(r);
  };
  main.timeScale().subscribeVisibleLogicalRangeChange(sync);
  const current = main.timeScale().getVisibleLogicalRange();
  if (current) sub.timeScale().setVisibleLogicalRange(current);
  return () => main.timeScale().unsubscribeVisibleLogicalRangeChange(sync);
}

/** Shared layout options for the oscillator sub-panes (RSI, MACD). */
const SUBPANE_OPTIONS = {
  autoSize: true,
  ...FIXED_SERIES_ORDER_OPTIONS,
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#7a7f87',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
  },
  grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
  rightPriceScale: { borderColor: '#26262d' },
  timeScale: { borderColor: '#26262d', visible: false },
  handleScroll: false,
  handleScale: false,
} as const;

/** One horizontal volume-profile bar, positioned in chart pixel coordinates. */
interface VpBar {
  key: number;
  top: number;
  height: number;
  widthPct: number;
  poc: boolean;
}

/** The chart objects realising one persisted drawing (price lines / a series). */
interface RenderedDrawing {
  priceLines: IPriceLine[];
  series: ISeriesApi<'Line'>[];
}

/**
 * Realise a stored drawing on the chart and return the created objects so it
 * can be torn down later. Drawings outside the loaded data range still render
 * (the chart clips / reveals them when scrolled into view), which is what lets
 * long-term levels persist across ranges.
 */
function renderDrawing(
  chart: IChartApi,
  candle: ISeriesApi<'Candlestick'>,
  d: Drawing,
): RenderedDrawing {
  const out: RenderedDrawing = { priceLines: [], series: [] };
  if (d.type === 'hline') {
    out.priceLines.push(
      candle.createPriceLine({ price: d.price, color: '#ffb000', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' }),
    );
  } else if (d.type === 'trend') {
    const series = addLineChartSeries(chart, {
      color: '#4cc2ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    series.setData([
      { time: d.a.time as UTCTimestamp, value: d.a.price },
      { time: d.b.time as UTCTimestamp, value: d.b.price },
    ]);
    out.series.push(series);
  } else {
    for (const lvl of fibLevels(d.a.price, d.b.price)) {
      out.priceLines.push(
        candle.createPriceLine({
          price: lvl.price,
          color: 'rgba(255,176,0,0.5)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: lvl.ratio.toFixed(3),
        }),
      );
    }
  }
  return out;
}

/** Tear down the chart objects of one rendered drawing. */
function removeRendered(
  chart: IChartApi | null,
  candle: ISeriesApi<'Candlestick'> | null,
  r: RenderedDrawing,
): void {
  if (candle) for (const l of r.priceLines) candle.removePriceLine(l);
  if (chart) for (const s of r.series) chart.removeSeries(s);
}

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

export function ChartModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const interval = (panel.params?.interval as Interval) ?? '1d';
  const range = (panel.params?.range as Range) ?? '6mo';
  const setPanelParams = usePanels((s) => s.setPanelParams);
  const alerts = useAlerts((s) => s.alerts);
  const priceAlerts = useMemo(
    () => alerts.filter((a) => a.symbol === symbol && a.metric === 'price'),
    [alerts, symbol],
  );

  const { data, error, loading, fetchedAt, refresh } = useFetch(
    (signal) => api.history(symbol as string, interval, range, signal),
    [symbol, interval, range],
    // Keep one inspectable source of truth. Stream trades do not carry
    // receipts, so they must not mutate receipted history candles.
    { enabled: Boolean(symbol), intervalMs: 15_000 },
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastBarRef = useRef<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);
  // Rendered drawings keyed by drawing id — the on-chart mirror of this
  // symbol's entries in useDrawings, so they can be torn down individually.
  const drawingsRef = useRef<Map<string, RenderedDrawing>>(new Map());
  // Pending first anchor for the two-click tools (trendline, fib).
  const anchorRef = useRef<{ time: number; price: number } | null>(null);
  const toolRef = useRef<Tool>('none');
  // Alert price-lines are keyed by alert id and kept separate from the cosmetic
  // draw lines above, so the two layers never clear each other.
  const alertLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const symbolRef = useRef(symbol);

  const [ind, setInd] = useState({
    sma: true,
    ema: false,
    bb: false,
    vwap: false,
    rsi: false,
    macd: false,
    vp: false,
  });
  const [tool, setTool] = useState<Tool>('none');
  // True after the first click of a two-click tool, awaiting the second.
  const [pending, setPending] = useState(false);
  // Volume-profile overlay bars (in pixel coords) and a tick that forces a
  // recompute when the price scale moves (pan/zoom/resize).
  const [vpBars, setVpBars] = useState<VpBar[]>([]);
  const [vpTick, setVpTick] = useState(0);
  const inspectedCalculations = useMemo(
    () => inspectChartCalculations(
      data?.candles ?? [],
      data?.receipt,
      symbol ?? '',
      interval,
      range,
      ind,
    ),
    [data?.candles, data?.receipt, symbol, interval, range, ind],
  );
  const calculationsActionable = isReceiptActionable(inspectedCalculations.receipt);

  // Tear down every rendered drawing. Chart-only: the persisted store is
  // untouched, so this is safe to run on symbol switch before restoring the
  // new symbol's set. The toolbar "clear" button also clears the store.
  const clearDrawings = useCallback(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    for (const r of drawingsRef.current.values()) removeRendered(chart, candle, r);
    drawingsRef.current.clear();
    anchorRef.current = null;
    setPending(false);
  }, []);

  // Toolbar "clear": wipe this symbol's drawings from the chart AND the store.
  const clearAllDrawings = useCallback(() => {
    clearDrawings();
    const sym = symbolRef.current;
    if (sym) useDrawings.getState().clearSymbol(sym);
  }, [clearDrawings]);

  // Create the chart once, on mount.
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

    const { candle, volume } = createPrimaryChartSeries(chart);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    // Click handling depends on the active tool: arm a price alert, drop a
    // horizontal line, or place one end of a two-click trendline / fib.
    chart.subscribeClick((param) => {
      const active = toolRef.current;
      if (active === 'none' || !param.point) return;
      const price = candle.coordinateToPrice(param.point.y);
      if (price == null) return;

      if (active === 'alert') {
        const sym = symbolRef.current;
        if (sym) {
          const reference = lastBarRef.current?.close ?? price;
          useAlerts.getState().addAlert({
            symbol: sym,
            metric: 'price',
            op: alertOpForLevel(price, reference),
            value: roundLevel(price),
            repeat: false,
          });
        }
        setTool('none');
        return;
      }

      if (active === 'hline') {
        const sym = symbolRef.current;
        if (sym) {
          const d = useDrawings.getState().addDrawing(sym, { type: 'hline', price });
          drawingsRef.current.set(d.id, renderDrawing(chart, candle, d));
        }
        setTool('none');
        return;
      }

      // Trendline / fib are two-click and need a time coordinate for the anchor.
      const time = typeof param.time === 'number' ? param.time : undefined;
      if (time == null) return;
      const anchor = anchorRef.current;
      if (!anchor) {
        anchorRef.current = { time, price };
        setPending(true);
        return;
      }
      if (anchor.time !== time) {
        const sym = symbolRef.current;
        if (sym) {
          if (active === 'trend') {
            const [a, b] = anchor.time < time ? [anchor, { time, price }] : [{ time, price }, anchor];
            const d = useDrawings.getState().addDrawing(sym, { type: 'trend', a, b });
            drawingsRef.current.set(d.id, renderDrawing(chart, candle, d));
          } else if (active === 'fib') {
            const d = useDrawings
              .getState()
              .addDrawing(sym, { type: 'fib', a: anchor, b: { time, price } });
            drawingsRef.current.set(d.id, renderDrawing(chart, candle, d));
          }
        }
      }
      anchorRef.current = null;
      setPending(false);
      setTool('none');
    });

    // Recompute the volume-profile overlay whenever the price scale shifts
    // (pan / zoom) or the panel resizes — its bars are in pixel coordinates.
    const bumpVp = () => setVpTick((t) => (t + 1) % 1_000_000);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bumpVp);
    const vpObserver = new ResizeObserver(bumpVp);
    vpObserver.observe(el);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bumpVp);
      vpObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    toolRef.current = tool;
    // Leaving a two-click tool abandons any half-placed anchor.
    if (tool !== 'trend' && tool !== 'fib') {
      anchorRef.current = null;
      setPending(false);
    }
  }, [tool]);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  // Mirror this symbol's price alerts as horizontal lines on the chart,
  // reconciling against the keyed map as alerts are added / removed / fire.
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    const lines = alertLinesRef.current;
    const seen = new Set<string>();
    for (const a of priceAlerts) {
      seen.add(a.id);
      const color =
        a.status === 'triggered'
          ? a.op === 'above'
            ? UP
            : a.op === 'below'
              ? DOWN
              : '#ffb000'
          : '#ffb000';
      const opts = {
        price: a.value,
        color,
        lineWidth: 1 as const,
        lineStyle: 2 as const,
        axisLabelVisible: true,
        title: `⚑${opSymbol(a.op)}`,
      };
      const existing = lines.get(a.id);
      if (existing) existing.applyOptions(opts);
      else lines.set(a.id, candle.createPriceLine(opts));
    }
    for (const [id, line] of lines) {
      if (!seen.has(id)) {
        candle.removePriceLine(line);
        lines.delete(id);
      }
    }
  }, [priceAlerts]);

  // On mount and every symbol change: tear down the old chart's drawings and
  // render the NEW symbol's persisted set, so one symbol's levels never leak
  // onto another's chart. Off-screen drawings (outside the loaded range) are
  // restored too — the chart clips them until they scroll into view. Drop the
  // prior symbol's last-bar reference while its receipted history reloads.
  useEffect(() => {
    clearDrawings();
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (chart && candle && symbol) {
      for (const d of useDrawings.getState().drawings[symbol] ?? []) {
        drawingsRef.current.set(d.id, renderDrawing(chart, candle, d));
      }
    }
    setTool('none');
    lastBarRef.current = null;
  }, [symbol, clearDrawings]);

  // Push new data into the series whenever it changes.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candle || !volume || !chart || !data) return;

    const candleTone = calculationsActionable ? null : '#7a7f87';
    candle.applyOptions({
      upColor: candleTone ?? UP,
      downColor: candleTone ?? DOWN,
      wickUpColor: candleTone ?? UP,
      wickDownColor: candleTone ?? DOWN,
    });

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
        color: calculationsActionable
          ? c.close >= c.open ? 'rgba(38,194,129,0.35)' : 'rgba(239,77,86,0.35)'
          : 'rgba(122,127,135,0.25)',
      })),
    );
    chart.timeScale().fitContent();

    const last = data.candles[data.candles.length - 1];
    lastBarRef.current = last
      ? { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close }
      : null;
  }, [data, calculationsActionable]);

  // Indicator overlays — rebuilt when data or the enabled studies change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data) return;

    for (const s of indicatorSeriesRef.current) chart.removeSeries(s);
    indicatorSeriesRef.current = [];

    const addLine = (points: LinePoint[], color: string) => {
      const series = addLineChartSeries(chart, {
        color: calculationsActionable ? color : '#7a7f87',
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
    if (ind.vwap) addLine(vwap(data.candles), '#e6e6e6');
  }, [data, ind, calculationsActionable]);

  // Volume-profile overlay: bucket volume by price, then map each bucket to
  // pixel coordinates via the candle series. Recomputed on data, toggle, and
  // every pan/zoom/resize (vpTick).
  useEffect(() => {
    const candle = candleRef.current;
    if (!ind.vp || !candle || !data) {
      setVpBars([]);
      return;
    }
    const profile = volumeProfile(data.candles, 24);
    if (profile.maxVolume <= 0) {
      setVpBars([]);
      return;
    }
    const bars: VpBar[] = [];
    for (let i = 0; i < profile.bins.length; i++) {
      const b = profile.bins[i];
      const yHigh = candle.priceToCoordinate(b.priceHigh);
      const yLow = candle.priceToCoordinate(b.priceLow);
      if (yHigh == null || yLow == null) continue;
      const top = Math.min(yHigh, yLow);
      const height = Math.max(1, Math.abs(yLow - yHigh) - 1);
      bars.push({
        key: i,
        top,
        height,
        widthPct: (b.volume / profile.maxVolume) * 28,
        poc: i === profile.pocIndex,
      });
    }
    setVpBars(bars);
  }, [data, ind.vp, vpTick]);

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

    const chart = createChart(el, SUBPANE_OPTIONS);
    const series = addLineChartSeries(chart, {
      color: calculationsActionable ? '#c08cff' : '#7a7f87',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    series.createPriceLine({ price: 70, color: calculationsActionable ? 'rgba(239,77,86,0.45)' : 'rgba(122,127,135,0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
    series.createPriceLine({ price: 30, color: calculationsActionable ? 'rgba(38,194,129,0.45)' : 'rgba(122,127,135,0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });
    rsiChartRef.current = chart;
    rsiSeriesRef.current = series;

    const unlink = main ? linkTimeScale(main, chart) : () => {};

    return () => {
      unlink();
      chart.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    };
  }, [ind.rsi, calculationsActionable]);

  // Feed the RSI series.
  useEffect(() => {
    const series = rsiSeriesRef.current;
    if (!series || !data) return;
    series.setData(
      rsi(data.candles, 14).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
  }, [data, ind.rsi]);

  // MACD oscillator sub-pane: histogram + macd/signal lines, time-synced to the
  // main chart just like RSI.
  useEffect(() => {
    if (!ind.macd) {
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
        macdHistRef.current = null;
        macdLineRef.current = null;
        macdSignalRef.current = null;
      }
      return;
    }
    const el = macdContainerRef.current;
    if (!el) return;
    const main = chartRef.current;

    const chart = createChart(el, SUBPANE_OPTIONS);
    const hist = addHistogramChartSeries(chart, { priceLineVisible: false, lastValueVisible: false });
    const macdLine = addLineChartSeries(chart, {
      color: calculationsActionable ? '#4cc2ff' : '#7a7f87',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    const signalLine = addLineChartSeries(chart, {
      color: calculationsActionable ? '#ffb000' : '#7a7f87',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    macdLine.createPriceLine({ price: 0, color: 'rgba(122,127,135,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    macdChartRef.current = chart;
    macdHistRef.current = hist;
    macdLineRef.current = macdLine;
    macdSignalRef.current = signalLine;

    const unlink = main ? linkTimeScale(main, chart) : () => {};

    return () => {
      unlink();
      chart.remove();
      macdChartRef.current = null;
      macdHistRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
    };
  }, [ind.macd, calculationsActionable]);

  // Feed the MACD series.
  useEffect(() => {
    const hist = macdHistRef.current;
    const line = macdLineRef.current;
    const signal = macdSignalRef.current;
    if (!hist || !line || !signal || !data) return;
    const m = macd(data.candles);
    line.setData(m.macd.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    signal.setData(m.signal.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    hist.setData(
      m.histogram.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.value,
        color: calculationsActionable
          ? p.value >= 0 ? 'rgba(38,194,129,0.5)' : 'rgba(239,77,86,0.5)'
          : 'rgba(122,127,135,0.35)',
      })),
    );
  }, [data, ind.macd, calculationsActionable]);

  const perf = inspectedCalculations.performance;

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-amber">{symbol}</span>
          {perf &&
            (() => {
              const shown = perf.last;
              const pct = perf.percent;
              return (
                <>
                  <span className="text-xs tabular-nums">{fmtPrice(shown)}</span>
                  <span className={`text-2xs tabular-nums ${calculationsActionable ? changeClass(pct) : 'text-term-muted'}`}>
                    {fmtSignedPercent(pct)} <span className="text-term-dim">{range}</span>
                  </span>
                </>
              );
            })()}
          <FreshnessAge fetchedAt={fetchedAt} staleAfterMs={30_000} />
          {data?.receipt && <SourceBadge receipt={data.receipt} compact />}
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
        {inspectedCalculations.receipt && <SourceBadge receipt={inspectedCalculations.receipt} compact />}
        {([
          ['sma', 'SMA 20'],
          ['ema', 'EMA 50'],
          ['bb', 'BB 20'],
          ['vwap', 'VWAP'],
          ['rsi', 'RSI 14'],
          ['macd', 'MACD'],
          ['vp', 'VP'],
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
        <span className="ml-auto" />
        {pending && <span className="mr-1 text-term-amber">click 2nd point…</span>}
        {([
          ['alert', '⚑ alert', 'Click the chart to set a price alert at that level'],
          ['hline', '＋ line', 'Click the chart to add a horizontal line'],
          ['trend', '╱ trend', 'Click two points to draw a trendline'],
          ['fib', 'fib', 'Click two swing points to draw fib retracement levels'],
        ] as const).map(([key, label, hint]) => (
          <button
            key={key}
            onClick={() => setTool((cur) => (cur === key ? 'none' : key))}
            title={hint}
            className={`rounded-sm px-1.5 py-0.5 ${
              tool === key ? 'text-term-amber' : 'text-term-muted hover:text-term-text'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={clearAllDrawings}
          title="Clear all drawings"
          className="rounded-sm px-1.5 py-0.5 text-term-muted hover:text-term-down"
        >
          clear
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`absolute inset-0 ${tool !== 'none' ? 'cursor-crosshair' : ''}`}
        />
        {ind.vp && vpBars.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-[5]">
            {vpBars.map((b) => (
              <div
                key={b.key}
                className="absolute left-0"
                style={{
                  top: b.top,
                  height: b.height,
                  width: `${b.widthPct}%`,
                  background: calculationsActionable
                    ? b.poc ? 'rgba(255,176,0,0.40)' : 'rgba(76,194,255,0.18)'
                    : 'rgba(122,127,135,0.20)',
                }}
              />
            ))}
          </div>
        )}
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label={`Loading ${symbol}`} />
          </div>
        )}
        {error && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ErrorMsg message={error} onRetry={refresh} />
          </div>
        )}
      </div>
      {ind.rsi && (
        <div className="relative h-20 shrink-0 border-t border-term-border">
          <div className="absolute left-1 top-0.5 z-10 text-2xs text-term-dim">RSI 14</div>
          <div ref={rsiContainerRef} className="absolute inset-0" />
        </div>
      )}
      {ind.macd && (
        <div className="relative h-20 shrink-0 border-t border-term-border">
          <div className="absolute left-1 top-0.5 z-10 text-2xs text-term-dim">MACD 12 26 9</div>
          <div ref={macdContainerRef} className="absolute inset-0" />
        </div>
      )}
    </div>
  );
}
