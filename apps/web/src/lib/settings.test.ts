import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  chartParamsFor,
  rootFontPx,
  CHART_TIMEFRAMES,
} from '@/lib/settings';

describe('sanitizeSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing fields from defaults', () => {
    expect(sanitizeSettings({ density: 'compact' })).toEqual({
      ...DEFAULT_SETTINGS,
      density: 'compact',
    });
  });

  it('rejects invalid enum values', () => {
    expect(sanitizeSettings({ density: 'huge' }).density).toBe(DEFAULT_SETTINGS.density);
    expect(sanitizeSettings({ chartTimeframe: '10Y' }).chartTimeframe).toBe(DEFAULT_SETTINGS.chartTimeframe);
  });

  it('rejects non-boolean toggles', () => {
    expect(sanitizeSettings({ showTicker: 'yes' }).showTicker).toBe(true);
    expect(sanitizeSettings({ reduceMotion: 1 }).reduceMotion).toBe(false);
  });

  it('passes through a fully valid object', () => {
    const s = {
      density: 'compact',
      showTicker: false,
      reduceMotion: true,
      chartTimeframe: '1Y',
      desktopNotifications: true,
    };
    expect(sanitizeSettings(s)).toEqual(s);
  });
});

describe('chartParamsFor', () => {
  it('overrides GP with the default timeframe preset', () => {
    expect(chartParamsFor('GP', { ...DEFAULT_SETTINGS, chartTimeframe: '1Y' })).toEqual({
      interval: '1d',
      range: '1y',
    });
  });

  it('defaults GP to 6M → 1d/6mo', () => {
    expect(chartParamsFor('GP', DEFAULT_SETTINGS)).toEqual({ interval: '1d', range: '6mo' });
  });

  it('does not override intraday (GIP) or non-chart commands', () => {
    expect(chartParamsFor('GIP', DEFAULT_SETTINGS)).toBeNull();
    expect(chartParamsFor('DES', DEFAULT_SETTINGS)).toBeNull();
  });
});

describe('rootFontPx', () => {
  it('makes compact smaller than comfortable', () => {
    expect(rootFontPx('compact')).toBeLessThan(rootFontPx('comfortable'));
  });
});

describe('CHART_TIMEFRAMES', () => {
  it('covers the six standard presets in order', () => {
    expect(CHART_TIMEFRAMES.map((t) => t.label)).toEqual(['1D', '5D', '1M', '6M', '1Y', '5Y']);
  });
});
