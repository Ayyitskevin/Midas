import { useMemo, type ReactNode } from 'react';
import { useJournal } from '@/store/useJournal';
import { deriveTrade } from '@/lib/journal';
import { buildEquityCurve } from '@/lib/equity';
import { changeClass } from '@/lib/format';
import type { ModuleProps } from './types';

const r2 = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
const round = (n: number): number => Math.round(n * 100) / 100;

function Stat({ label, value, accent, hint }: { label: string; value: ReactNode; accent?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
      {hint && <span className="text-2xs text-term-muted">{hint}</span>}
    </div>
  );
}

export function EquityModule(_props: ModuleProps) {
  const trades = useJournal((s) => s.trades);

  const curve = useMemo(() => {
    const pts = trades
      .map((t) => ({ t, d: deriveTrade(t) }))
      .filter(({ d }) => d.rMultiple != null)
      .map(({ t, d }) => ({ at: t.closedAt ?? t.openedAt, r: d.rMultiple as number }));
    return buildEquityCurve(pts);
  }, [trades]);

  const { points } = curve;

  if (points.length === 0) {
    return (
      <div className="p-3 text-xs text-term-muted">
        No scored trades yet. Close trades in the <span className="text-term-amber">LOG</span> panel to build an equity
        curve.
      </div>
    );
  }

  const streak = curve.currentStreak;
  const streakLabel =
    streak.type === 'win' ? `${streak.count}W` : streak.type === 'loss' ? `${streak.count}L` : '—';
  const streakAccent =
    streak.type === 'win' ? 'text-term-up' : streak.type === 'loss' ? 'text-term-down' : undefined;

  // Chart geometry — cumulative R with a 0 baseline always in view.
  const cum = points.map((p) => p.cumR);
  const lo = Math.min(0, ...cum);
  const hi = Math.max(0, ...cum);
  const span = hi - lo || 1;
  const W = 240;
  const H = 64;
  const pad = 3;
  const xAt = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * W);
  const yAt = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(xAt(i))} ${round(yAt(p.cumR))}`).join(' ');
  const zeroY = round(yAt(0));
  const up = curve.totalR >= 0;

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Net R" value={r2(curve.totalR)} accent={changeClass(curve.totalR)} />
        <Stat label="Max DD" value={`−${curve.maxDrawdownR.toFixed(2)}R`} accent="text-term-down" />
        <Stat label="Streak" value={streakLabel} accent={streakAccent} />
        <Stat label="Closed" value={`${curve.wins + curve.losses}`} hint={`${curve.wins}W · ${curve.losses}L`} />
        <Stat label="Peak R" value={r2(curve.peakR)} />
        <Stat label="Best/worst run" value={`${curve.longestWinStreak}W / ${curve.longestLossStreak}L`} />
      </div>

      <div className="rounded-sm border border-term-border p-2">
        <div className="mb-1 text-2xs text-term-dim">Cumulative R · {points.length} trades</div>
        {points.length >= 2 ? (
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <line
              x1="0"
              y1={zeroY}
              x2={W}
              y2={zeroY}
              stroke="currentColor"
              strokeWidth={1}
              className="text-term-border"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className={up ? 'text-term-up' : 'text-term-down'}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="py-3 text-center text-2xs text-term-muted">Need ≥ 2 closed trades for a curve.</div>
        )}
      </div>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Equity is cumulative R from your scored trades, ordered by close time. Drawdown is the largest drop from a
        running peak.
      </p>
    </div>
  );
}
