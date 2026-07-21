import { describe, expect, it, vi } from 'vitest';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import {
  CHART_DOWN,
  CHART_UP,
  FIXED_SERIES_ORDER_OPTIONS,
  addHistogramChartSeries,
  addLineChartSeries,
  createPrimaryChartSeries,
  rebuildComparisonChartSeries,
  replaceRatioChartSeries,
} from './chartSeries';

function fakeSeries() {
  const applyOptions = vi.fn();
  return {
    api: {
      createPriceLine: vi.fn(),
      priceScale: vi.fn(() => ({ applyOptions })),
      setData: vi.fn(),
    },
    applyOptions,
  };
}

function fakeChart(series: ReturnType<typeof fakeSeries>['api'][]) {
  const addSeries = vi.fn((_definition: unknown, _options: unknown) => {
    const next = series.shift();
    if (!next) throw new Error('unexpected addSeries call');
    return next;
  });
  const fitContent = vi.fn();
  const removeSeries = vi.fn();
  const chart = {
    addSeries,
    removeSeries,
    timeScale: vi.fn(() => ({ fitContent })),
  } as unknown as IChartApi;
  return { addSeries, chart, fitContent, removeSeries };
}

describe('lightweight-charts v5 series integration', () => {
  it('creates GP candle and overlay-volume series with fixed v4 ordering', () => {
    const candle = fakeSeries();
    const volume = fakeSeries();
    const { addSeries, chart } = fakeChart([candle.api, volume.api]);

    expect(createPrimaryChartSeries(chart)).toEqual({ candle: candle.api, volume: volume.api });
    expect(FIXED_SERIES_ORDER_OPTIONS).toEqual({ hoveredSeriesOnTop: false });
    expect(addSeries).toHaveBeenNthCalledWith(
      1,
      CandlestickSeries,
      expect.objectContaining({
        upColor: CHART_UP,
        downColor: CHART_DOWN,
        borderVisible: false,
        wickUpColor: CHART_UP,
        wickDownColor: CHART_DOWN,
      }),
    );
    expect(addSeries).toHaveBeenNthCalledWith(
      2,
      HistogramSeries,
      expect.objectContaining({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      }),
    );
    expect(volume.applyOptions).toHaveBeenCalledWith({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
  });

  it('forwards the v5 line and histogram definitions, options, and result', () => {
    const line = fakeSeries();
    const histogram = fakeSeries();
    const { addSeries, chart } = fakeChart([line.api, histogram.api]);
    const lineOptions = { color: '#fff', lineWidth: 2 as const };
    const histogramOptions = { priceLineVisible: false };

    expect(addLineChartSeries(chart, lineOptions)).toBe(line.api);
    expect(addHistogramChartSeries(chart, histogramOptions)).toBe(histogram.api);
    expect(addSeries).toHaveBeenNthCalledWith(1, LineSeries, lineOptions);
    expect(addSeries).toHaveBeenNthCalledWith(2, HistogramSeries, histogramOptions);
  });

  it('rebuilds COMP lines, skips empty inputs, and draws one zero baseline', () => {
    const old = fakeSeries();
    const first = fakeSeries();
    const second = fakeSeries();
    const { addSeries, chart, fitContent, removeSeries } = fakeChart([first.api, second.api]);

    const next = rebuildComparisonChartSeries(
      chart,
      [old.api as unknown as ISeriesApi<'Line'>],
      [
        { color: '#skip', points: [] },
        { color: '#one', points: [{ time: 1, value: 0 }, { time: 2, value: 5 }] },
        { color: '#two', points: [{ time: 1, value: -2 }] },
      ],
    );

    expect(removeSeries).toHaveBeenCalledOnce();
    expect(addSeries).toHaveBeenCalledTimes(2);
    expect(addSeries).toHaveBeenNthCalledWith(
      1,
      LineSeries,
      expect.objectContaining({ color: '#one', priceFormat: { type: 'percent' } }),
    );
    expect(first.api.setData).toHaveBeenCalledWith([
      { time: 1, value: 0 },
      { time: 2, value: 5 },
    ]);
    expect(first.api.createPriceLine).toHaveBeenCalledOnce();
    expect(second.api.createPriceLine).not.toHaveBeenCalled();
    expect(next).toEqual([first.api, second.api]);
    expect(fitContent).toHaveBeenCalledOnce();
  });

  it('keeps RATIO empty honestly, then restores precision and content fitting', () => {
    const old = fakeSeries();
    const fresh = fakeSeries();
    const { addSeries, chart, fitContent, removeSeries } = fakeChart([fresh.api]);

    expect(
      replaceRatioChartSeries(chart, old.api as unknown as ISeriesApi<'Line'>, [], 4),
    ).toBeNull();
    expect(removeSeries).toHaveBeenCalledWith(old.api);
    expect(addSeries).not.toHaveBeenCalled();
    expect(fitContent).not.toHaveBeenCalled();

    expect(replaceRatioChartSeries(chart, null, [{ time: 3, value: 1.2345 }], 4)).toBe(fresh.api);
    expect(addSeries).toHaveBeenCalledWith(
      LineSeries,
      expect.objectContaining({
        priceFormat: expect.objectContaining({ type: 'price', precision: 4 }),
      }),
    );
    const ratioOptions = addSeries.mock.calls[0]?.[1] as {
      priceFormat?: { minMove?: number };
    };
    expect(ratioOptions.priceFormat?.minMove).toBeCloseTo(0.0001, 8);
    expect(fresh.api.setData).toHaveBeenCalledWith([{ time: 3, value: 1.2345 }]);
    expect(fitContent).toHaveBeenCalledOnce();
  });
});
