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
import { useStream } from '@/lib/stream';
import { usePanels } from '@/store/usePanels';
import { useAlerts } from '@/store/useAlerts';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { INTERVAL_SECONDS, candleBucketStart } from '@/lib/candleBucket';
import { alertOpForLevel, opSymbol } from '@/lib/alerts';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
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
  // Latest interval in a ref so the stream callback (stable, empty deps) can
  // read it without resubscribing on every interval change.
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const setPanelParams = usePanels((s) => s.setPanelParams);
  const alerts = useAlerts((s) => s.alerts);
  const priceAlerts = useMemo(
    () => alerts.filter((a) => a.symbol === symbol && a.metric === 'price'),
    [alerts, symbol],
  );

  const { data, error, loading, refresh } = useFetch(
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
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
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
  const [livePrice, setLivePrice] = useState<number | null>(null);
  // Volume-profile overlay bars (in pixel coords) and a tick that forces a
  // recompute when the price scale moves (pan/zoom/resize).
  const [vpBars, setVpBars] = useState<VpBar[]>([]);
  const [vpTick, setVpTick] = useState(0);

  const clearDrawings = useCallback(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (candle) for (const l of priceLinesRef.current) candle.removePriceLine(l);
    priceLinesRef.current = [];
    if (chart) for (const s of trendSeriesRef.current) chart.removeSeries(s);
    trendSeriesRef.current = [];
    anchorRef.current = null;
    setPending(false);
  }, []);

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
        priceLinesRef.current.push(
          candle.createPriceLine({ price, color: '#ffb000', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' }),
        );
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
        if (active === 'trend') {
          const [a, b] = anchor.time < time ? [anchor, { time, price }] : [{ time, price }, anchor];
          const series = chart.addLineSeries({
            color: '#4cc2ff',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          series.setData([
            { time: a.time as UTCTimestamp, value: a.price },
            { time: b.time as UTCTimestamp, value: b.price },
          ]);
          trendSeriesRef.current.push(series);
        } else if (active === 'fib') {
          for (const lvl of fibLevels(anchor.price, price)) {
            priceLinesRef.current.push(
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

  // Live chart: feed streamed trade prints into the forming (last) candle.
  useStream(
    'trades',
    symbol,
    useCallback((d: unknown) => {
      const price = (d as { price?: number }).price;
      const ts = (d as { timestamp?: number }).timestamp;
      const bar = lastBarRef.current;
      const candle = candleRef.current;
      if (!bar || !candle || typeof price !== 'number') return;

      // Roll a fresh candle when the print's timestamp crosses into a new
      // interval bucket — otherwise every print folds into the last candle,
      // ballooning its range at a stale timestamp and no new bar ever forms.
      const stepSec = INTERVAL_SECONDS[intervalRef.current] ?? 0;
      const bucket = ts != null && stepSec > 0 ? candleBucketStart(ts, stepSec) : (bar.time as number);
      if (bucket > (bar.time as number)) {
        const fresh = { time: bucket, open: price, high: price, low: price, close: price };
        lastBarRef.current = fresh;
        candle.update({ time: bucket as UTCTimestamp, open: price, high: price, low: price, close: price });
        setLivePrice(price);
        return;
      }

      bar.close = price;
      if (price > bar.high) bar.high = price;
      if (price < bar.low) bar.low = price;
      candle.update({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      setLivePrice(price);
    }, []),
  );

  // Clear drawings when the symbol changes.
  useEffect(() => {
    clearDrawings();
    setTool('none');
  }, [symbol, clearDrawings]);

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

    const last = data.candles[data.candles.length - 1];
    lastBarRef.current = last
      ? { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close }
      : null;
    setLivePrice(null);
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
    if (ind.vwap) addLine(vwap(data.candles), '#e6e6e6');
  }, [data, ind]);

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

    const unlink = main ? linkTimeScale(main, chart) : () => {};

    return () => {
      unlink();
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
    const hist = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const macdLine = chart.addLineSeries({
      color: '#4cc2ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    const signalLine = chart.addLineSeries({
      color: '#ffb000',
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
  }, [ind.macd]);

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
        color: p.value >= 0 ? 'rgba(38,194,129,0.5)' : 'rgba(239,77,86,0.5)',
      })),
    );
  }, [data, ind.macd]);

  const perf = useMemo(() => {
    if (!data || data.candles.length < 2) return null;
    const first = data.candles[0].close;
    const last = data.candles[data.candles.length - 1].close;
    return { first, last };
  }, [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-amber">{symbol}</span>
          {perf &&
            (() => {
              // Derive the % from the SHOWN (live) price so the header stays
              // internally consistent as prints tick in — not frozen at load.
              const shown = livePrice ?? perf.last;
              const pct = perf.first === 0 ? 0 : ((shown - perf.first) / perf.first) * 100;
              return (
                <>
                  <span className="text-xs tabular-nums">{fmtPrice(shown)}</span>
                  <span className={`text-2xs tabular-nums ${changeClass(pct)}`}>
                    {fmtSignedPercent(pct)} <span className="text-term-dim">{range}</span>
                  </span>
                </>
              );
            })()}
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
          onClick={clearDrawings}
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
                  background: b.poc ? 'rgba(255,176,0,0.40)' : 'rgba(76,194,255,0.18)',
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
