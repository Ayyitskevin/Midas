import { Fragment, useMemo } from 'react';
import type { Candle } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { computeSeasonality, type Bucket } from '@/lib/seasonality';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MIN_N = 5; // ignore thin buckets when picking best/worst

function heatColor(avg: number | null, maxAbs: number): string {
  if (avg == null || maxAbs <= 0) return 'transparent';
  const intensity = Math.min(Math.abs(avg) / maxAbs, 1);
  const rgb = avg >= 0 ? '38,194,129' : '239,77,86';
  return `rgba(${rgb},${(0.12 + intensity * 0.6).toFixed(3)})`;
}

const signed = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

interface Pick {
  v: number;
  i: number;
}

function bestWorst(buckets: Bucket[], labels: string[]): { best?: string; worst?: string } {
  let best: Pick | null = null;
  let worst: Pick | null = null;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.avg == null || b.n < MIN_N) continue;
    if (best === null || b.avg > best.v) best = { v: b.avg, i };
    if (worst === null || b.avg < worst.v) worst = { v: b.avg, i };
  }
  return {
    best: best ? `${labels[best.i]} ${signed(best.v)}` : undefined,
    worst: worst ? `${labels[worst.i]} ${signed(worst.v)}` : undefined,
  };
}

export function SeasonalityModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, '60m', '3mo', signal),
    [symbol],
    { enabled: !!symbol },
  );

  const season = useMemo(
    () => computeSeasonality((data?.candles ?? []).map((c: Candle) => ({ time: c.time, close: c.close }))),
    [data],
  );

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT SEAS</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (season.totalSamples === 0) {
    return <div className="p-3 text-xs text-term-muted">Not enough history for {symbol}.</div>;
  }

  const hourLabels = HOURS.map((h) => `${String(h).padStart(2, '0')}:00`);
  const hod = bestWorst(season.byHour, hourLabels);
  const dow = bestWorst(season.byDay, DAY_LABELS);

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-auto p-2">
      <div className="text-2xs text-term-dim">Avg hourly return · UTC · 3mo · n={season.totalSamples}</div>

      <div className="min-w-[320px]">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }}>
          <div />
          {HOURS.map((h) => (
            <div key={h} className="text-center text-[8px] leading-none text-term-dim">
              {h % 6 === 0 ? h : ''}
            </div>
          ))}
          {DAY_LABELS.map((label, di) => (
            <Fragment key={label}>
              <div className="pr-1 text-right text-2xs leading-none text-term-muted">{label}</div>
              {HOURS.map((h) => {
                const cell = season.grid[di][h];
                const hh = String(h).padStart(2, '0');
                return (
                  <div
                    key={h}
                    className="aspect-square rounded-[1px] border border-term-border/30"
                    style={{ backgroundColor: heatColor(cell.avg, season.maxAbsAvg) }}
                    title={
                      cell.avg == null
                        ? `${label} ${hh}:00 · no data`
                        : `${label} ${hh}:00 · ${signed(cell.avg)} · n=${cell.n}`
                    }
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 text-2xs">
        <div className="flex items-center gap-3">
          <span className="w-12 text-term-dim">By hour</span>
          {hod.best && <span className="text-term-up">↑ {hod.best}</span>}
          {hod.worst && <span className="text-term-down">↓ {hod.worst}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="w-12 text-term-dim">By day</span>
          {dow.best && <span className="text-term-up">↑ {dow.best}</span>}
          {dow.worst && <span className="text-term-down">↓ {dow.worst}</span>}
        </div>
      </div>

      <p className="px-0.5 text-2xs leading-relaxed text-term-dim">
        Green = average gain in that UTC hour, red = average loss, over the last 3 months of hourly candles. Thin
        samples are noisy.
      </p>
    </div>
  );
}
