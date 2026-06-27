import { describe, it, expect } from 'vitest';
import { computeVolumeIndex, volumeIndexBoard, sortVolumeIndex, type VolIdxBar, type VolIdxRow } from './volumeIndex';

const bar = (close: number, volume: number): VolIdxBar => ({ close, volume });

// signalPeriod 2, base 1000. EMA(period 2) is recursive k=2/3, first-value seed.
// up: NVI rises (return compounds on the down-volume bar), ends above its EMA.
//   close 100→110→121, volume 100→80(down)→120(up)
//   NVI = [1000, 1100, 1100]; PVI = [1000, 1000, 1100]
//   nviSignal = ema([1000,1100,1100],2) last = 1088.888…; nvi 1100 > signal → bull
const up: VolIdxBar[] = [bar(100, 100), bar(110, 80), bar(121, 120)];
// down: NVI falls on the down-volume bar, ends below its EMA.
//   NVI = [1000, 900, 900]; nviSignal = ema([1000,900,900],2) last = 911.11… → bear
const down: VolIdxBar[] = [bar(100, 100), bar(90, 80), bar(85, 120)];

describe('computeVolumeIndex', () => {
  it('updates NVI on down-volume and PVI on up-volume, NVI above its EMA → bull', () => {
    const r = computeVolumeIndex(up, 2, 1000)!;
    expect(r.nvi).toBeCloseTo(1100, 6);
    expect(r.pvi).toBeCloseTo(1100, 6);
    expect(r.nviSignal).toBeCloseTo(1088.8888888, 4);
    expect(r.nviDist).toBeCloseTo(((1100 - 1088.8888888) / 1088.8888888) * 100, 4);
    expect(r.nviRegime).toBe('bull');
    expect(r.pviRegime).toBe('bull');
    expect(r.n).toBe(3);
  });

  it('reads NVI below its EMA as a bear regime', () => {
    const r = computeVolumeIndex(down, 2, 1000)!;
    expect(r.nvi).toBeCloseTo(900, 6);
    expect(r.nviRegime).toBe('bear');
  });

  it('leaves both lines unchanged when volume never changes', () => {
    // constant volume → neither volDown nor volUp ever true → NVI = PVI = base
    const r = computeVolumeIndex([bar(100, 100), bar(110, 100), bar(120, 100)], 2, 1000)!;
    expect(r.nvi).toBe(1000);
    expect(r.pvi).toBe(1000);
    expect(r.nviDist).toBeCloseTo(0, 6); // line flat at base = its own EMA
  });

  it('returns null with fewer than signalPeriod bars', () => {
    expect(computeVolumeIndex([bar(100, 100)], 2, 1000)).toBeNull();
    expect(computeVolumeIndex([], 2, 1000)).toBeNull();
  });
});

describe('volumeIndexBoard', () => {
  const series = [
    { symbol: 'UP', bars: up }, // NVI above EMA
    { symbol: 'DOWN', bars: down }, // NVI below EMA
  ];

  it('defaults to sorting by NVI distance descending', () => {
    const rows = volumeIndexBoard(series, 'nvi', 2, 1000);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].nviRegime).toBe('bull');
    expect(rows[1].nviRegime).toBe('bear');
  });

  it('sorts by symbol', () => {
    const rows = volumeIndexBoard(series, 'symbol', 2, 1000);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = volumeIndexBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: [bar(100, 100)] },
      ],
      'nvi',
      2,
      1000,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortVolumeIndex', () => {
  it('orders by NVI distance descending', () => {
    const rows = [
      { symbol: 'A', nviDist: 1 },
      { symbol: 'B', nviDist: 4 },
      { symbol: 'C', nviDist: -2 },
    ] as VolIdxRow[];
    expect(sortVolumeIndex(rows, 'nvi').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
