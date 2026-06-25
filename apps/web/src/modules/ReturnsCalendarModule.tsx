import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { returnsCalendar } from '@/lib/returnsCalendar';
import { fmtSignedPercent } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];
const base = (sym: string) => sym.replace(/\/.*$/, '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

/** rgba fill for a day cell, green up / red down, opacity by magnitude. */
function cellColor(ret: number, maxAbs: number): string {
  if (maxAbs <= 0 || ret === 0) return 'rgba(122,127,135,0.22)';
  const op = 0.18 + 0.82 * Math.min(1, Math.abs(ret) / maxAbs);
  return ret > 0 ? `rgba(38,194,129,${op})` : `rgba(239,77,86,${op})`;
}

export function ReturnsCalendarModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(1); // default 1Y
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const h = await api.history(symbol!, tf.interval, tf.range, signal);
      return { candles: h.candles };
    },
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const cal = useMemo(() => (data ? returnsCalendar(data.candles) : null), [data]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!cal || size.w <= 0 || size.h <= 0) return null;
    const padL = 22;
    const padR = 4;
    const padT = 12;
    const padB = 2;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const cell = Math.max(3, Math.min(pw / cal.weeks, ph / 7));
    const rect = Math.max(2, cell - Math.max(1, cell * 0.14));
    const x = (week: number) => padL + week * cell;
    const y = (weekday: number) => padT + weekday * cell;

    // Month labels at the first column of each month, skipping near-collisions.
    const months: { x: number; label: string }[] = [];
    let lastMonth = '';
    let lastX = -1e9;
    for (const d of cal.days) {
      const ym = d.date.slice(0, 7);
      if (ym !== lastMonth) {
        lastMonth = ym;
        const mx = x(d.week);
        if (mx - lastX >= 18) {
          months.push({ x: mx, label: MONTHS[Number(d.date.slice(5, 7)) - 1] });
          lastX = mx;
        }
      }
    }
    return { padL, padT, cell, rect, x, y, months };
  }, [cal, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!cal) return <EmptyState>Not enough history for a returns calendar.</EmptyState>;

  const streakLabel =
    cal.streak > 0 ? `${cal.streak}d up` : cal.streak < 0 ? `${-cal.streak}d down` : 'flat';
  const streakColor = cal.streak > 0 ? 'text-term-up' : cal.streak < 0 ? 'text-term-down' : 'text-term-muted';

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} daily returns</span>
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">best <span className="text-term-up">{fmtSignedPercent(cal.best ? cal.best.ret * 100 : null)}</span></span>
        <span className="text-term-muted">worst <span className="text-term-down">{fmtSignedPercent(cal.worst ? cal.worst.ret * 100 : null)}</span></span>
        <span className="text-term-muted">+days <span className="text-term-text">{(cal.positiveRate * 100).toFixed(0)}%</span></span>
        <span className="ml-auto text-term-muted">streak <span className={streakColor}>{streakLabel}</span></span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* weekday labels */}
              {Object.entries(WEEKDAY_LABELS).map(([wd, label]) => (
                <text
                  key={wd}
                  x={2}
                  y={view.y(Number(wd)) + view.cell / 2 + 2}
                  className="text-term-dim"
                  fill="currentColor"
                  style={{ fontSize: 7 }}
                >
                  {label}
                </text>
              ))}
              {/* month labels */}
              {view.months.map((m, i) => (
                <text key={i} x={m.x} y={8} className="text-term-dim" fill="currentColor" style={{ fontSize: 7 }}>
                  {m.label}
                </text>
              ))}
              {/* day cells */}
              {cal.days.map((d, i) => (
                <rect
                  key={i}
                  x={view.x(d.week)}
                  y={view.y(d.weekday)}
                  width={view.rect}
                  height={view.rect}
                  rx={1}
                  fill={cellColor(d.ret, cal.maxAbsReturn)}
                >
                  <title>{`${d.date}  ${fmtSignedPercent(d.ret * 100)}`}</title>
                </rect>
              ))}
            </svg>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span>{cal.count} days · avg {fmtSignedPercent(cal.avgReturn * 100)}</span>
        <span className="ml-auto flex items-center gap-1">
          loss
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: 'rgba(239,77,86,0.9)' }} />
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: 'rgba(122,127,135,0.3)' }} />
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: 'rgba(38,194,129,0.9)' }} />
          gain
        </span>
      </div>
    </div>
  );
}
