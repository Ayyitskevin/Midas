import type { EquityPoint } from '@midas/shared';

/** Pure view math for the AEQ equity chart (SVG polyline, no chart dep). */

export interface EquityStats {
  first: number;
  last: number;
  min: number;
  max: number;
  /** Change from first to last snapshot, in % (null when first is 0). */
  changePct: number | null;
}

export function equityStats(points: EquityPoint[]): EquityStats | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.totalUsd);
  const first = values[0];
  const last = values[values.length - 1];
  return {
    first,
    last,
    min: Math.min(...values),
    max: Math.max(...values),
    changePct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null,
  };
}

/**
 * Map a series onto an SVG polyline `points` string for a w×h viewBox,
 * x by TIME (so irregular snapshot gaps render honestly, not evenly), y
 * scaled to the value range with a flat line centered when min === max.
 */
export function polylinePoints(points: EquityPoint[], w: number, h: number): string {
  if (points.length === 0) return '';
  const t0 = points[0].at;
  const t1 = points[points.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const values = points.map((p) => p.totalUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return points
    .map((p) => {
      const x = points.length === 1 ? w / 2 : ((p.at - t0) / span) * w;
      const y = range === 0 ? h / 2 : h - ((p.totalUsd - min) / range) * h;
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(' ');
}
