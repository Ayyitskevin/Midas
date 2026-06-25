import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact, fmtTimeAgo } from '@/lib/format';
import { projectFunding, type PerpSide } from '@/lib/fundingPnl';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
const INTERVALS = [8, 4, 1];

const inputCls =
  'w-full rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function FundingPnlModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data: deriv, error, loading, refresh } = useFetch(
    (signal) => api.derivatives(symbol!, signal),
    [symbol],
    { intervalMs: 30_000, enabled: !!symbol },
  );

  const [side, setSide] = useState<PerpSide>('long');
  const [notionalStr, setNotionalStr] = useState('10000');
  const [horizonStr, setHorizonStr] = useState('30');
  const [intervalHours, setIntervalHours] = useState(8);
  const [rateStr, setRateStr] = useState(''); // % per interval, seeds from live

  useEffect(() => setRateStr(''), [symbol]);
  useEffect(() => {
    if (deriv?.fundingRate != null) {
      setRateStr((prev) => (prev === '' ? String(+(deriv.fundingRate! * 100).toFixed(5)) : prev));
    }
  }, [deriv]);

  const proj = useMemo(
    () =>
      projectFunding({
        side,
        notional: num(notionalStr),
        rate: num(rateStr) / 100,
        intervalHours,
        horizonDays: num(horizonStr),
      }),
    [side, notionalStr, rateStr, intervalHours, horizonStr],
  );

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

  const chart = useMemo(() => {
    if (!proj.valid || proj.points.length < 2 || size.w <= 0 || size.h <= 0) return null;
    const last = proj.horizonTotal;
    const lo = Math.min(0, last);
    const hi = Math.max(0, last);
    const span = hi - lo || 1;
    const n = proj.points.length;
    const xAt = (i: number) => (i / (n - 1)) * size.w;
    const yAt = (v: number) => size.h - ((v - lo) / span) * (size.h - 2) - 1;
    const line = proj.points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.cum).toFixed(1)}`).join(' ');
    const area = `M ${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} L ${line} L ${xAt(n - 1).toFixed(1)},${yAt(0).toFixed(1)} Z`;
    return { line, area, zeroY: yAt(0) };
  }, [proj, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !deriv) return <Loading label={`Loading ${symbol} funding`} />;
  if (error && !deriv) return <ErrorMsg message={error} onRetry={refresh} />;

  const liveRate = deriv?.fundingRate ?? null;
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const carryColor = proj.receives ? 'text-term-up' : 'text-term-down';
  const stroke = proj.receives ? 'rgba(38,194,129,0.9)' : 'rgba(239,77,86,0.9)';
  const fill = proj.receives ? 'rgba(38,194,129,0.14)' : 'rgba(239,77,86,0.14)';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2 text-2xs">
        <div className="flex overflow-hidden rounded-sm border border-term-border">
          {(['long', 'short'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`px-2 py-1 uppercase ${
                side === s
                  ? s === 'long'
                    ? 'bg-term-up/20 text-term-up'
                    : 'bg-term-down/20 text-term-down'
                  : 'text-term-muted hover:text-term-text'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-term-dim">
          live {liveRate != null ? `${(liveRate * 100).toFixed(4)}%/${intervalHours}h` : '—'}
          {deriv?.nextFundingTime ? ` · next ${fmtTimeAgo(deriv.nextFundingTime)}` : ''}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <Field label="Notional ($)">
          <input type="number" inputMode="decimal" value={notionalStr} onChange={(e) => setNotionalStr(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Rate (%/int)">
          <input type="number" inputMode="decimal" value={rateStr} onChange={(e) => setRateStr(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Horizon (d)">
          <input type="number" inputMode="decimal" value={horizonStr} onChange={(e) => setHorizonStr(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex shrink-0 overflow-hidden rounded-sm border border-term-border">
          {INTERVALS.map((h) => (
            <button
              key={h}
              onClick={() => setIntervalHours(h)}
              className={`px-1.5 py-1 text-2xs ${intervalHours === h ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'}`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {proj.valid ? (
        <>
          <div className={`rounded-sm border px-3 py-2 ${proj.receives ? 'border-term-up/30 bg-term-up/5' : 'border-term-down/30 bg-term-down/5'}`}>
            <div className="text-2xs uppercase tracking-wide text-term-dim">
              {proj.receives ? 'Funding earned' : 'Funding paid'} over {horizonStr}d · {proj.intervals} settlements
            </div>
            <div className={`font-mono text-xl ${carryColor}`}>
              {sign(proj.horizonTotal)}${fmtCompact(Math.abs(proj.horizonTotal))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label={`Per ${intervalHours}h`} value={`${sign(proj.perInterval)}$${fmtPrice(Math.abs(proj.perInterval))}`} accent={carryColor} />
            <Stat label="Per day" value={`${sign(proj.daily)}$${fmtPrice(Math.abs(proj.daily))}`} accent={carryColor} />
            <Stat label="Carry APR" value={`${sign(proj.aprPct)}${Math.abs(proj.aprPct).toFixed(2)}%`} accent={carryColor} />
          </div>

          <div className="relative min-h-0 flex-1">
            <div ref={wrapRef} className="absolute inset-0">
              {chart && (
                <svg width={size.w} height={size.h} className="block">
                  <line x1={0} x2={size.w} y1={chart.zeroY} y2={chart.zeroY} stroke="rgba(122,127,135,0.4)" strokeWidth={1} strokeDasharray="3 3" />
                  <path d={chart.area} fill={fill} />
                  <polyline points={chart.line} fill="none" stroke={stroke} strokeWidth={1.25} />
                </svg>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-3 text-center text-2xs text-term-muted">
          Enter a notional, rate and horizon to project the carry.
        </div>
      )}

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Assumes the funding rate holds for the whole horizon. A long pays funding when the rate is positive
        (and receives when negative); a short is the mirror. Gross of trading fees and price P&L.
      </p>
    </div>
  );
}
