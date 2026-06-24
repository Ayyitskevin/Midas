import { useEffect, useMemo, useState } from 'react';
import {
  generateEvents,
  groupByDay,
  nextFundingTimes,
  formatCountdown,
  utcHm,
  type EventCategory,
  type MarketEvent,
} from '@/lib/calendar';
import type { ModuleProps } from './types';

interface CatMeta {
  key: EventCategory;
  label: string;
  dot: string;
}

const CATS: CatMeta[] = [
  { key: 'funding', label: 'Funding', dot: 'bg-term-accent' },
  { key: 'expiry', label: 'Expiry', dot: 'bg-term-amber' },
  { key: 'close', label: 'Close', dot: 'bg-term-up' },
];

const DOT = new Map(CATS.map((c) => [c.key, c.dot]));

function EventRow({ e, now }: { e: MarketEvent; now: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-term-border/40 px-2 py-1">
      <span className="w-10 shrink-0 font-mono text-2xs text-term-dim">{utcHm(e.time)}</span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT.get(e.category)}`} />
      <span className={`flex-1 truncate text-xs ${e.major ? 'text-term-amber' : 'text-term-text'}`}>{e.title}</span>
      <span className="shrink-0 font-mono text-2xs text-term-muted">{formatCountdown(e.time - now)}</span>
    </div>
  );
}

export function CalendarModule(_props: ModuleProps) {
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState<Set<EventCategory>>(() => new Set(['funding', 'expiry', 'close']));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const events = useMemo(() => generateEvents(now), [now]);
  const groups = useMemo(() => groupByDay(events.filter((e) => active.has(e.category))), [events, active]);

  const nextFunding = nextFundingTimes(now, 1)[0];
  const nextMajor = events.find((e) => e.major) ?? null;

  const toggle = (k: EventCategory) =>
    setActive((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="no-drag flex h-full flex-col">
      {/* Countdowns */}
      <div className="grid grid-cols-2 gap-2 border-b border-term-border p-2">
        <div>
          <div className="text-2xs uppercase tracking-wide text-term-dim">Next funding</div>
          <div className="font-mono text-sm text-term-accent">{formatCountdown(nextFunding - now)}</div>
          <div className="text-2xs text-term-dim">{utcHm(nextFunding)} UTC</div>
        </div>
        <div className="min-w-0">
          <div className="text-2xs uppercase tracking-wide text-term-dim">Next major</div>
          {nextMajor ? (
            <>
              <div className="font-mono text-sm text-term-amber">{formatCountdown(nextMajor.time - now)}</div>
              <div className="truncate text-2xs text-term-muted">{nextMajor.title}</div>
            </>
          ) : (
            <div className="font-mono text-sm text-term-dim">—</div>
          )}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex items-center gap-1 border-b border-term-border px-2 py-1">
        {CATS.map((c) => {
          const on = active.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs ${
                on ? 'text-term-text' : 'text-term-dim'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${on ? c.dot : 'bg-term-dim'}`} />
              {c.label}
            </button>
          );
        })}
        <span className="ml-auto text-2xs text-term-dim">UTC · next 30d</span>
      </div>

      {/* Timeline */}
      <div className="scroll-term min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="p-4 text-center text-xs text-term-muted">No events match the selected filters.</div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 bg-term-header px-2 py-0.5 text-2xs uppercase tracking-wide text-term-muted">
                {g.label}
              </div>
              {g.events.map((e) => (
                <EventRow key={e.id} e={e} now={now} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
