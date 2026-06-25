import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { riskOfRuin, ruinCurve } from '@/lib/ror';
import { fmtPrice } from '@/lib/format';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/** Probability → percent string, with a floor label for vanishingly small values. */
function fmtProb(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.0001) return '<0.01%';
  return `${(p * 100).toFixed(2)}%`;
}

/** Severity color for a ruin probability. */
const ruinColor = (p: number): string =>
  p < 0.01 ? 'text-term-up' : p < 0.1 ? 'text-term-amber' : 'text-term-down';

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <div className="flex items-center gap-1 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 focus-within:border-term-amber/60">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-term-text outline-none placeholder:text-term-dim"
        />
        {suffix && <span className="shrink-0 text-2xs text-term-dim">{suffix}</span>}
      </div>
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

const STEPS = 64;

export function RorModule(_props: ModuleProps) {
  const [winRate, setWinRate] = useState('55');
  const [payoff, setPayoff] = useState('1.5');
  const [riskPct, setRiskPct] = useState('2');
  const [ruinPct, setRuinPct] = useState('100');

  const inputs = {
    winRate: num(winRate) / 100,
    payoff: num(payoff),
    riskPct: num(riskPct),
    ruinPct: num(ruinPct),
  };
  const result = useMemo(
    () => riskOfRuin(inputs),
    [inputs.winRate, inputs.payoff, inputs.riskPct, inputs.ruinPct],
  );

  const risk = inputs.riskPct;
  const xMax = useMemo(
    () => (Number.isFinite(risk) && risk > 0 ? Math.max(20, Math.ceil(risk)) : 20),
    [risk],
  );
  const curve = useMemo(() => {
    if (!result.valid) return [] as { riskPct: number; riskOfRuin: number }[];
    const risks = Array.from({ length: STEPS }, (_, i) => (xMax * (i + 1)) / STEPS);
    return ruinCurve({ winRate: inputs.winRate, payoff: inputs.payoff, ruinPct: inputs.ruinPct }, risks);
  }, [result.valid, inputs.winRate, inputs.payoff, inputs.ruinPct, xMax]);

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
    if (curve.length < 2 || size.w <= 0 || size.h <= 0) return null;
    const padL = 26;
    const padR = 6;
    const padT = 6;
    const padB = 14;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const xAt = (v: number) => padL + (v / xMax) * pw;
    const yAt = (p: number) => padT + (1 - Math.max(0, Math.min(1, p))) * ph;
    const pts = curve.map((c) => `${xAt(c.riskPct).toFixed(1)},${yAt(c.riskOfRuin).toFixed(1)}`).join(' ');
    const markX = Number.isFinite(risk) && risk > 0 && risk <= xMax ? xAt(risk) : null;
    return { padL, padR, padT, padB, pw, ph, xAt, yAt, pts, markX };
  }, [curve, size, xMax, risk]);

  const showEmpty = !result.valid;
  const filledMaxDD = result.edge ? `${result.expectedMaxDD.toFixed(1)}%` : '≥100%';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Win rate" value={winRate} onChange={setWinRate} suffix="%" placeholder="55" />
        <Field label="Payoff (R:R)" value={payoff} onChange={setPayoff} suffix="×" placeholder="1.5" />
        <Field label="Risk / trade" value={riskPct} onChange={setRiskPct} suffix="%" placeholder="2" />
        <Field label="Ruin at" value={ruinPct} onChange={setRuinPct} suffix="%" placeholder="100" />
      </div>

      {showEmpty ? (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          Enter a win rate (0–100%), a payoff above 0, and a positive risk-per-trade % to model ruin.
        </div>
      ) : (
        <>
          {/* Headline: probability of ruin */}
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-term-dim">Risk of ruin</span>
              <span
                className={`rounded-sm border border-current px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${
                  result.edge ? 'text-term-up' : 'text-term-down'
                }`}
              >
                {result.edge ? 'Positive edge' : 'No edge'}
              </span>
            </div>
            <div className={`font-mono text-xl ${ruinColor(result.riskOfRuin)}`}>
              {fmtProb(result.riskOfRuin)}
            </div>
            <div className="text-2xs text-term-muted">
              {result.edge
                ? `chance of a ${num(ruinPct) || 100}% drawdown at ${riskPct || '—'}% risk per trade`
                : 'no positive edge — ruin is eventually certain at any bet size'}
            </div>
          </div>

          {/* Diagnostics */}
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Expectancy"
              value={`${result.expectancy >= 0 ? '+' : ''}${result.expectancy.toFixed(3)} R`}
              accent={result.edge ? 'text-term-up' : 'text-term-down'}
            />
            <Stat label="Per-trade σ" value={`${result.stdev.toFixed(2)} R`} />
            <Stat label="Units to ruin" value={fmtPrice(result.unitsToRuin, 1)} />
            <Stat label="Exp. max DD" value={filledMaxDD} />
          </div>

          {/* Survival curve */}
          <div className="flex flex-col">
            <div className="text-2xs uppercase tracking-wide text-term-dim">Ruin probability vs risk / trade</div>
            <div className="relative h-28 min-h-0">
              <div ref={wrapRef} className="absolute inset-0">
                {view && (
                  <svg width={size.w} height={size.h} className="block">
                    {/* frame + 50% gridline */}
                    <line
                      x1={view.padL}
                      x2={view.padL + view.pw}
                      y1={view.yAt(0.5)}
                      y2={view.yAt(0.5)}
                      stroke="rgba(122,127,135,0.2)"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                    <line
                      x1={view.padL}
                      x2={view.padL}
                      y1={view.padT}
                      y2={view.padT + view.ph}
                      stroke="rgba(122,127,135,0.4)"
                      strokeWidth={1}
                    />
                    <line
                      x1={view.padL}
                      x2={view.padL + view.pw}
                      y1={view.padT + view.ph}
                      y2={view.padT + view.ph}
                      stroke="rgba(122,127,135,0.4)"
                      strokeWidth={1}
                    />
                    {/* current-risk marker */}
                    {view.markX != null && (
                      <>
                        <line
                          x1={view.markX}
                          x2={view.markX}
                          y1={view.padT}
                          y2={view.padT + view.ph}
                          stroke="rgba(255,176,0,0.5)"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                        />
                        <circle
                          cx={view.markX}
                          cy={view.yAt(result.riskOfRuin)}
                          r={2.5}
                          fill="rgb(255,176,0)"
                        />
                      </>
                    )}
                    {/* curve */}
                    <polyline points={view.pts} fill="none" stroke="rgba(76,194,255,0.95)" strokeWidth={1.5} />
                    {/* axis labels */}
                    <text x={2} y={view.padT + 7} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>100%</text>
                    <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>0%</text>
                    <text x={view.padL + view.pw} y={view.padT + view.ph + 11} textAnchor="end" className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>{xMax}% risk</text>
                  </svg>
                )}
              </div>
            </div>
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            Ruin is modeled as a drifting random walk over an unlimited series of trades. With an edge, smaller
            bets push ruin toward zero; without one, no bet size is safe. Real systems also face changing edges
            and correlated losing streaks, so treat this as a floor on the danger.
          </p>
        </>
      )}
    </div>
  );
}
