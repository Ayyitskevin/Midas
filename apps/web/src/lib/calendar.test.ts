import { describe, it, expect } from 'vitest';
import {
  generateEvents,
  nextFundingTimes,
  groupByDay,
  formatCountdown,
  utcHm,
} from '@/lib/calendar';

const DAY = 86_400_000;
const FUNDING_SLOT = 8 * 3_600_000;
const NEW_YEAR = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00Z (a funding instant)

describe('nextFundingTimes', () => {
  it('returns evenly spaced future slots on the 8h grid', () => {
    const ts = nextFundingTimes(NEW_YEAR, 3);
    expect(ts).toHaveLength(3);
    expect(ts[0]).toBeGreaterThan(NEW_YEAR);
    expect(ts[0]).toBe(NEW_YEAR + FUNDING_SLOT); // next after 00:00 is 08:00
    for (const t of ts) expect(t % FUNDING_SLOT).toBe(0);
    expect(ts[1] - ts[0]).toBe(FUNDING_SLOT);
  });

  it('advances past a non-aligned now', () => {
    const [first] = nextFundingTimes(NEW_YEAR + 60_000, 1); // a minute past 00:00
    expect(first).toBe(NEW_YEAR + FUNDING_SLOT);
  });
});

describe('generateEvents', () => {
  const events = generateEvents(NEW_YEAR, { horizonDays: 30, fundingDays: 3 });

  it('returns sorted, future, uniquely-identified events within the horizon', () => {
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    for (const e of events) {
      expect(e.time).toBeGreaterThan(NEW_YEAR);
      expect(e.time).toBeLessThanOrEqual(NEW_YEAR + 30 * DAY);
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it('places every expiry at 08:00 UTC and every close at 00:00 UTC', () => {
    for (const e of events.filter((x) => x.category === 'expiry')) {
      const d = new Date(e.time);
      expect(d.getUTCHours()).toBe(8);
      expect(d.getUTCMinutes()).toBe(0);
    }
    for (const e of events.filter((x) => x.category === 'close')) {
      expect(new Date(e.time).getUTCHours()).toBe(0);
    }
  });

  it('keeps funding within its shorter sub-horizon', () => {
    const funding = events.filter((e) => e.category === 'funding');
    expect(funding.length).toBeGreaterThan(0);
    for (const f of funding) expect(f.time).toBeLessThanOrEqual(NEW_YEAR + 3 * DAY);
  });

  it('flags January’s last Friday as the (non-quarterly) monthly expiry', () => {
    const majors = events.filter((e) => e.category === 'expiry' && e.major);
    expect(majors).toHaveLength(1);
    expect(majors[0].title).toBe('Monthly expiry');
  });

  it('flags a quarter-month last Friday as the quarterly expiry', () => {
    const march = generateEvents(Date.UTC(2026, 2, 1), { horizonDays: 31 });
    const quarterly = march.filter((e) => e.category === 'expiry' && e.title === 'Quarterly expiry');
    expect(quarterly).toHaveLength(1);
    expect(quarterly[0].major).toBe(true);
  });
});

describe('groupByDay', () => {
  it('buckets events that share a UTC day and keeps day order', () => {
    const groups = groupByDay(generateEvents(NEW_YEAR, { horizonDays: 5 }));
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.events.length).toBeGreaterThan(0);
    // First group's events all precede the second group's.
    expect(groups[0].events[0].time).toBeLessThan(groups[1].events[0].time);
  });
});

describe('formatCountdown', () => {
  it('formats across the minute/hour/day boundaries', () => {
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(30_000)).toBe('<1m');
    expect(formatCountdown(45 * 60_000)).toBe('45m');
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatCountdown(50 * 3_600_000)).toBe('2d 2h');
  });
});

describe('utcHm', () => {
  it('renders zero-padded UTC time', () => {
    expect(utcHm(Date.UTC(2026, 0, 1, 8, 0))).toBe('08:00');
    expect(utcHm(Date.UTC(2026, 0, 1, 16, 30))).toBe('16:30');
  });
});
