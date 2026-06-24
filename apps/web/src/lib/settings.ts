/**
 * User preferences — pure types, defaults and helpers shared by the settings
 * store, the module UI and the consumers that read them (chart open, the
 * document-level display effects). No React or store imports, so it stays
 * eager and cheap while the panel that edits it is lazily code-split.
 */

import type { Interval, Range } from '@midas/shared';

export type Density = 'comfortable' | 'compact';

export type ChartTimeframe = '1D' | '5D' | '1M' | '6M' | '1Y' | '5Y';

export interface ChartTimeframePreset {
  label: ChartTimeframe;
  interval: Interval;
  range: Range;
}

/** Default-chart timeframes, mirroring the in-panel chart's preset buttons. */
export const CHART_TIMEFRAMES: readonly ChartTimeframePreset[] = [
  { label: '1D', interval: '5m', range: '1d' },
  { label: '5D', interval: '30m', range: '5d' },
  { label: '1M', interval: '1d', range: '1mo' },
  { label: '6M', interval: '1d', range: '6mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '5Y', interval: '1wk', range: '5y' },
];

export interface Settings {
  /** UI density — compact tightens the global type scale. */
  density: Density;
  /** Show the scrolling ticker tape under the top bar. */
  showTicker: boolean;
  /** Suppress non-essential motion (ticker marquee, fades). */
  reduceMotion: boolean;
  /** Timeframe a fresh price chart (GP) opens at. */
  chartTimeframe: ChartTimeframe;
  /** Fire an OS/Web notification when an alert triggers. */
  desktopNotifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  density: 'comfortable',
  showTicker: true,
  reduceMotion: false,
  chartTimeframe: '6M',
  desktopNotifications: false,
};

const DENSITIES: readonly Density[] = ['comfortable', 'compact'];
const TIMEFRAME_LABELS: readonly ChartTimeframe[] = CHART_TIMEFRAMES.map((t) => t.label);

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Coerce an untrusted blob (persisted state) into valid Settings. */
export function sanitizeSettings(data: unknown): Settings {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    density: pick(d.density, DENSITIES, DEFAULT_SETTINGS.density),
    showTicker: bool(d.showTicker, DEFAULT_SETTINGS.showTicker),
    reduceMotion: bool(d.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    chartTimeframe: pick(d.chartTimeframe, TIMEFRAME_LABELS, DEFAULT_SETTINGS.chartTimeframe),
    desktopNotifications: bool(d.desktopNotifications, DEFAULT_SETTINGS.desktopNotifications),
  };
}

/** Root font-size (px) for a density — scales the rem-based type system. */
export function rootFontPx(density: Density): number {
  return density === 'compact' ? 14 : 16;
}

/**
 * Chart interval/range a command should open at given user settings. Only the
 * generic price chart (GP) honours the default timeframe; intraday (GIP) and
 * everything else keep their command-defined params (null = no override).
 */
export function chartParamsFor(
  code: string,
  settings: Settings,
): { interval: Interval; range: Range } | null {
  if (code !== 'GP') return null;
  const tf = CHART_TIMEFRAMES.find((t) => t.label === settings.chartTimeframe) ?? CHART_TIMEFRAMES[3];
  return { interval: tf.interval, range: tf.range };
}
