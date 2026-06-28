import { describe, it, expect } from 'vitest';
import {
  computeCyberCycle,
  cyberCycleBoard,
  sortCyberCycle,
  type CyberCycleBar,
  type CyberCycleRow,
} from './cybercycle';

// median = high = low = m, so the fixtures are exact.
const bar = (m: number): CyberCycleBar => ({ high: m, low: m });
const bars = (ms: number[]) => ms.map(bar);

// Primary fixture — independently verified by a multi-agent workflow against
// Ehlers' Cyber Cycle (reference impl + two adversarial recomputations, all
// machine-zero). α=0.07, warm-up on the first 6 bars then recursion from i=6.
// Final raw Cycle = −3.839886738769819 (cyclePct = ×100 / 18).
const primary = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18];
// A cycle that troughs at the penultimate bar → fresh bull turn on the last bar.
const bull = [100, 103, 106, 107, 106, 103, 100, 97, 94, 93, 94, 97];
// Mirror image → fresh bear turn.
const bear = [100, 97, 94, 93, 94, 97, 100, 103, 106, 107, 106, 103];

describe('computeCyberCycle', () => {
  it('matches the workflow-verified cycle (as a percent of price)', () => {
    const r = computeCyberCycle(bars(primary), 0.07)!;
    expect(r.cyclePct).toBeCloseTo(-21.332704, 5); // 100 · −3.839887 / 18
    expect(r.trigPct).toBeCloseTo(-19.276365, 5); // 100 · −3.469746 / 18
    expect(r.cross).toBe('none'); // monotonic fall in the recursion region
    expect(r.n).toBe(12);
  });

  it('fires a bull cross when the cycle turns up', () => {
    const r = computeCyberCycle(bars(bull), 0.07)!;
    expect(r.cyclePct).toBeCloseTo(-7.556691, 5);
    expect(r.cross).toBe('bull');
  });

  it('fires a bear cross when the cycle turns down', () => {
    const r = computeCyberCycle(bars(bear), 0.07)!;
    expect(r.cyclePct).toBeCloseTo(7.116496, 5);
    expect(r.cross).toBe('bear');
  });

  it('is scale-invariant (cycle as a price ratio)', () => {
    const r = computeCyberCycle(bars(primary), 0.07)!;
    const scaled = computeCyberCycle(bars(primary.map((m) => m * 1000)), 0.07)!;
    expect(scaled.cyclePct).toBeCloseTo(r.cyclePct, 9);
    expect(scaled.cross).toBe(r.cross);
  });

  it('returns null with fewer than 8 bars or a bad alpha', () => {
    expect(computeCyberCycle(bars(primary.slice(0, 7)), 0.07)).toBeNull();
    expect(computeCyberCycle([], 0.07)).toBeNull();
    expect(computeCyberCycle(bars(primary), 0)).toBeNull();
  });
});

describe('cyberCycleBoard', () => {
  const series = [
    { symbol: 'HOT', bars: bars(bear) }, // cyclePct ≈ +7.12
    { symbol: 'WARM', bars: bars(bull) }, // cyclePct ≈ −7.56
    { symbol: 'COLD', bars: bars(primary) }, // cyclePct ≈ −21.33
  ];

  it('defaults to sorting by cycle percent descending', () => {
    const rows = cyberCycleBoard(series, 'cycle', 0.07);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'WARM', 'COLD']);
  });

  it('sorts by symbol', () => {
    const rows = cyberCycleBoard(series, 'symbol', 0.07);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'HOT', 'WARM']);
  });

  it('skips symbols with too little history', () => {
    const rows = cyberCycleBoard(
      [
        { symbol: 'OK', bars: bars(primary) },
        { symbol: 'THIN', bars: bars(primary.slice(0, 7)) },
      ],
      'cycle',
      0.07,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCyberCycle', () => {
  it('orders by cyclePct descending', () => {
    const rows = [
      { symbol: 'A', cyclePct: 0.3 },
      { symbol: 'B', cyclePct: 1.2 },
      { symbol: 'C', cyclePct: -0.5 },
    ] as CyberCycleRow[];
    expect(sortCyberCycle(rows, 'cycle').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
