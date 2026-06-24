/**
 * A computed crypto market calendar — pure, offline, deterministic from the
 * clock. Rather than depend on an external events feed (and ship dates that go
 * stale), it derives the recurring market timing that's provable from the
 * calendar itself:
 *
 *   - funding  — perp funding settlements every 8h (00:00 / 08:00 / 16:00 UTC)
 *   - expiry   — options/futures expiries at 08:00 UTC; the last Friday of a
 *                month is the monthly expiry, and Mar/Jun/Sep/Dec the quarterly
 *   - close    — weekly (Mon) and monthly (1st) candle closes at 00:00 UTC
 *
 * Macro events (FOMC, CPI, token unlocks) need an external feed; this module is
 * the seam where such a provider would merge in.
 *
 * Every function takes `now` (epoch ms) so the core is deterministic and
 * testable; the component supplies Date.now().
 */

export type EventCategory = 'funding' | 'expiry' | 'close';

export interface MarketEvent {
  id: string;
  /** Event instant, epoch ms (UTC). */
  time: number;
  category: EventCategory;
  title: string;
  detail: string;
  /** Headline events (monthly/quarterly expiry, monthly close). */
  major: boolean;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const FUNDING_SLOT = 8 * HOUR;
const EXPIRY_HOUR = 8; // 08:00 UTC
const QUARTER_MONTHS = new Set([2, 5, 8, 11]); // Mar, Jun, Sep, Dec

/** UTC midnight of the day containing `ts` (epoch is itself UTC-midnight aligned). */
function utcMidnight(ts: number): number {
  return Math.floor(ts / DAY) * DAY;
}

/** The next `count` perp funding settlements strictly after `now`. */
export function nextFundingTimes(now: number, count: number): number[] {
  const first = Math.floor(now / FUNDING_SLOT) * FUNDING_SLOT + FUNDING_SLOT;
  return Array.from({ length: Math.max(0, count) }, (_, i) => first + i * FUNDING_SLOT);
}

/** Is the 08:00-UTC instant `ts` the last Friday of its (UTC) month? */
function isLastFridayUTC(ts: number): boolean {
  const d = new Date(ts);
  if (d.getUTCDay() !== 5) return false; // 5 = Friday
  return new Date(ts + 7 * DAY).getUTCMonth() !== d.getUTCMonth();
}

/** Daily 08:00-UTC expiry instants in (now, end]. */
function expiryTimes(now: number, end: number): number[] {
  const out: number[] = [];
  let t = utcMidnight(now) + EXPIRY_HOUR * HOUR;
  if (t <= now) t += DAY;
  for (; t <= end; t += DAY) out.push(t);
  return out;
}

/** Weekly (Mon) and monthly (1st) 00:00-UTC closes in (now, end]. */
function closeTimes(now: number, end: number): Array<{ time: number; monthly: boolean }> {
  const out: Array<{ time: number; monthly: boolean }> = [];
  let t = utcMidnight(now);
  if (t <= now) t += DAY;
  for (; t <= end; t += DAY) {
    const d = new Date(t);
    if (d.getUTCDate() === 1) out.push({ time: t, monthly: true });
    else if (d.getUTCDay() === 1) out.push({ time: t, monthly: false }); // 1 = Monday
  }
  return out;
}

export interface GenerateOpts {
  /** Days ahead to include expiries and closes (default 30). */
  horizonDays?: number;
  /** Days ahead to include funding settlements (default 3, to avoid noise). */
  fundingDays?: number;
}

/** Build the upcoming market events within the horizon, sorted ascending. */
export function generateEvents(now: number, opts: GenerateOpts = {}): MarketEvent[] {
  const horizonDays = opts.horizonDays ?? 30;
  const fundingDays = opts.fundingDays ?? 3;
  const end = now + horizonDays * DAY;
  const events: MarketEvent[] = [];

  for (const t of expiryTimes(now, end)) {
    let title = 'Daily options expiry';
    let major = false;
    if (isLastFridayUTC(t)) {
      if (QUARTER_MONTHS.has(new Date(t).getUTCMonth())) {
        title = 'Quarterly expiry';
        major = true;
      } else {
        title = 'Monthly expiry';
        major = true;
      }
    }
    events.push({ id: `expiry-${t}`, time: t, category: 'expiry', title, detail: '08:00 UTC', major });
  }

  for (const c of closeTimes(now, end)) {
    events.push({
      id: `close-${c.time}`,
      time: c.time,
      category: 'close',
      title: c.monthly ? 'Monthly candle close' : 'Weekly candle close',
      detail: '00:00 UTC',
      major: c.monthly,
    });
  }

  const fundingEnd = Math.min(end, now + fundingDays * DAY);
  for (const t of nextFundingTimes(now, Math.ceil((fundingEnd - now) / FUNDING_SLOT))) {
    if (t > fundingEnd) break;
    events.push({ id: `funding-${t}`, time: t, category: 'funding', title: 'Perp funding', detail: 'Settlement', major: false });
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

export interface DayGroup {
  key: string;
  label: string;
  events: MarketEvent[];
}

/** Group events by their UTC calendar day, preserving order. */
export function groupByDay(events: MarketEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const e of events) {
    const d = new Date(e.time);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(e.time), events: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups;
}

/** "Mon, Jan 5" in UTC. */
export function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "HH:MM" in UTC. */
export function utcHm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Compact countdown: "<1m", "45m", "3h 12m", "2d 4h". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
