import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type CandlestickSeriesPartialOptions,
  type HistogramSeriesPartialOptions,
  type IChartApi,
  type ISeriesApi,
  type LineSeriesPartialOptions,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { LinePoint } from './indicators';

export const CHART_UP = '#26c281';
export const CHART_DOWN = '#ef4d56';

/**
 * lightweight-charts v5.2 raises a hovered series above its peers by default.
 * Midas keeps the fixed v4 draw order so candles, overlays, comparison lines,
 * and oscillator series do not reorder under the pointer.
 */
export const FIXED_SERIES_ORDER_OPTIONS = { hoveredSeriesOnTop: false } as const;

export function addCandlestickChartSeries(
  chart: IChartApi,
  options: CandlestickSeriesPartialOptions,
): ISeriesApi<'Candlestick'> {
  return chart.addSeries(CandlestickSeries, options);
}

export function addHistogramChartSeries(
  chart: IChartApi,
  options: HistogramSeriesPartialOptions,
): ISeriesApi<'Histogram'> {
  return chart.addSeries(HistogramSeries, options);
}

export function addLineChartSeries(
  chart: IChartApi,
  options: LineSeriesPartialOptions,
): ISeriesApi<'Line'> {
  return chart.addSeries(LineSeries, options);
}

/** Create the primary price and overlay-volume series used by GP. */
export function createPrimaryChartSeries(chart: IChartApi): {
  candle: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
} {
  const candle = addCandlestickChartSeries(chart, {
    upColor: CHART_UP,
    downColor: CHART_DOWN,
    borderVisible: false,
    wickUpColor: CHART_UP,
    wickDownColor: CHART_DOWN,
  });
  const volume = addHistogramChartSeries(chart, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  return { candle, volume };
}

export interface ComparisonChartInput {
  color: string;
  points: LinePoint[];
}

/** Replace COMP's rebased lines while preserving its single zero baseline. */
export function rebuildComparisonChartSeries(
  chart: IChartApi,
  current: ISeriesApi<'Line'>[],
  inputs: ComparisonChartInput[],
): ISeriesApi<'Line'>[] {
  for (const series of current) chart.removeSeries(series);

  const next: ISeriesApi<'Line'>[] = [];
  let zeroLineDrawn = false;
  for (const { color, points } of inputs) {
    if (points.length === 0) continue;
    const series = addLineChartSeries(chart, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      priceFormat: { type: 'percent' },
    });
    series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    if (!zeroLineDrawn) {
      series.createPriceLine({
        price: 0,
        color: 'rgba(122,127,135,0.4)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: '',
      });
      zeroLineDrawn = true;
    }
    next.push(series);
  }
  chart.timeScale().fitContent();
  return next;
}

/** Replace RATIO's one line, retaining the honest empty-series path. */
export function replaceRatioChartSeries(
  chart: IChartApi,
  current: ISeriesApi<'Line'> | null,
  points: LinePoint[],
  precision: number,
): ISeriesApi<'Line'> | null {
  if (current) chart.removeSeries(current);
  if (points.length === 0) return null;

  const series = addLineChartSeries(chart, {
    color: '#ffb000',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: 'price', precision, minMove: Math.pow(10, -precision) },
  });
  series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
  chart.timeScale().fitContent();
  return series;
}
