import { describe, it, expect } from 'vitest';
import type { EquityPoint } from '@midas/shared';
import { equityStats, polylinePoints } from './equityView';

const pt = (at: number, totalUsd: number): EquityPoint => ({ at, totalUsd, unrealizedPnlUsd: null });

describe('equityStats', () => {
  it('summarizes first/last/min/max and % change', () => {
    const s = equityStats([pt(0, 100), pt(1, 80), pt(2, 130)]);
    expect(s).toEqual({ first: 100, last: 130, min: 80, max: 130, changePct: 30 });
  });

  it('handles empty and zero-first series', () => {
    expect(equityStats([])).toBeNull();
    expect(equityStats([pt(0, 0), pt(1, 50)])?.changePct).toBeNull();
  });
});

describe('polylinePoints', () => {
  it('maps x by time and y by value range', () => {
    // Irregular time gaps: the middle point sits at 25% of the width, not 50%.
    const s = polylinePoints([pt(0, 0), pt(25, 50), pt(100, 100)], 100, 100);
    expect(s.split(' ')).toEqual(['0,100', '25,50', '100,0']);
  });

  it('renders flat series centered and singletons mid-panel', () => {
    expect(polylinePoints([pt(0, 5), pt(10, 5)], 100, 100)).toBe('0,50 100,50');
    expect(polylinePoints([pt(0, 5)], 100, 100)).toBe('50,50');
    expect(polylinePoints([], 100, 100)).toBe('');
  });
});
