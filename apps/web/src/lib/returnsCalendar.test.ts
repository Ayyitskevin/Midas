import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { returnsCalendar } from './returnsCalendar';

/** Daily candle at a given UTC day index, time in seconds (exercises the s→ms path). */
const candle = (dayIndex: number, close: number): Candle => ({
  time: dayIndex * 86400,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

const series = (startDay: number, closes: number[]): Candle[] =>
  closes.map((c, i) => candle(startDay + i, c));

describe('returnsCalendar', () => {
  it('computes daily returns and the headline stats', () => {
    // Day 19001 is a Sunday; closes give returns +0.10, −0.10, 0, +0.05.
    const cal = returnsCalendar(series(19000, [100, 110, 99, 99, 103.95]))!;
    expect(cal).not.toBeNull();
    expect(cal.count).toBe(4);
    expect(cal.weeks).toBe(1);
    expect(cal.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3]);
    expect(cal.days[0].ret).toBeCloseTo(0.1, 10);
    expect(cal.days[1].ret).toBeCloseTo(-0.1, 10);
    expect(cal.maxAbsReturn).toBeCloseTo(0.1, 10);
    expect(cal.best!.ret).toBeCloseTo(0.1, 10);
    expect(cal.worst!.ret).toBeCloseTo(-0.1, 10);
    expect(cal.positiveRate).toBeCloseTo(0.5, 10);
    expect(cal.avgReturn).toBeCloseTo(0.0125, 10);
    expect(cal.streak).toBe(1); // last day up, prior day flat breaks the run
    expect(cal.days[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lays days out into week-columns starting each Sunday', () => {
    // 11 candles from a Saturday → 10 returns spanning two Sunday-started weeks.
    const cal = returnsCalendar(series(19000, Array.from({ length: 11 }, (_, i) => 100 + i)))!;
    expect(cal.count).toBe(10);
    expect(cal.weeks).toBe(2);
    // The 8th return-day (day index 19008) is the Sunday that opens column 1.
    expect(cal.days[7].week).toBe(1);
    expect(cal.days[7].weekday).toBe(0);
    expect(cal.positiveRate).toBe(1);
    expect(cal.streak).toBe(10);
  });

  it('signs the streak negative on a losing run', () => {
    const cal = returnsCalendar(series(19000, [100, 101, 100, 99]))!;
    expect(cal.count).toBe(3);
    expect(cal.streak).toBe(-2); // last two days down, then an up day
    expect(cal.positiveRate).toBeCloseTo(1 / 3, 10);
  });

  it('returns null when there is nothing to chart', () => {
    expect(returnsCalendar([])).toBeNull();
    expect(returnsCalendar(series(19000, [100]))).toBeNull(); // need ≥2 candles
    expect(returnsCalendar(series(19000, [0, 100]))).toBeNull(); // no valid prior close
  });
});
