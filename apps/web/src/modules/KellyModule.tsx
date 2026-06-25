import { useMemo, useState, type ReactNode } from 'react';
import { kelly } from '@/lib/kelly';
import { fmtPrice, fmtSigned, changeClass } from '@/lib/format';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/** Fraction → percent string, e.g. 0.0625 → "6.25%". */
const pct = (f: number, decimals = 2): string => `${(f * 100).toFixed(decimals)}%`;

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

/** The Kelly scalings shown in the sizing table. */
const TIERS = [
  { key: 'full', label: 'Full Kelly', note: 'growth-optimal', accent: 'text-term-amber' },
  { key: 'half', label: 'Half Kelly', note: 'common default', accent: 'text-term-text' },
  { key: 'quarter', label: 'Quarter Kelly', note: 'conservative', accent: 'text-term-muted' },
] as const;

export function KellyModule(_props: ModuleProps) {
  const [winRate, setWinRate] = useState('55');
  const [payoff, setPayoff] = useState('2');
  const [account, setAccount] = useState('10000');

  const result = useMemo(
    () => kelly({ winRate: num(winRate) / 100, payoff: num(payoff) }),
    [winRate, payoff],
  );

  const acct = num(account);
  const hasAccount = Number.isFinite(acct) && acct > 0;
  const fractionOf = { full: result.fraction, half: result.half, quarter: result.quarter };

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Win rate" value={winRate} onChange={setWinRate} suffix="%" placeholder="55" />
        <Field label="Payoff (R:R)" value={payoff} onChange={setPayoff} suffix="×" placeholder="2" />
        <Field label="Account" value={account} onChange={setAccount} suffix="$" placeholder="10000" />
        <div className="flex items-end justify-end pb-1">
          {result.valid && (
            <span
              className={`rounded-sm border border-current px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${
                result.edge ? 'text-term-up' : 'text-term-down'
              }`}
            >
              {result.edge ? 'Positive edge' : 'No edge'}
            </span>
          )}
        </div>
      </div>

      {result.valid ? (
        <div className="flex flex-col gap-2">
          {/* Headline: full-Kelly fraction */}
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="text-2xs uppercase tracking-wide text-term-dim">Kelly fraction (full)</div>
            <div className="font-mono text-xl text-term-amber">
              {pct(result.fraction)}{' '}
              <span className="text-sm text-term-muted">of bankroll</span>
            </div>
            <div className="text-2xs text-term-muted">
              {hasAccount
                ? `≈ $${fmtPrice(acct * result.fraction)} risked per bet`
                : 'Enter an account size to see the dollar stake'}
            </div>
          </div>

          {/* Kelly scalings */}
          <div className="rounded-sm border border-term-border">
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-1 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
              <span>Sizing</span>
              <span className="text-right">Fraction</span>
              <span className="text-right">Risk</span>
            </div>
            {TIERS.map((t) => {
              const f = fractionOf[t.key];
              return (
                <div key={t.key} className="grid grid-cols-[1.4fr_1fr_1fr] gap-1 px-2 py-1 font-mono text-xs">
                  <span className="flex flex-col">
                    <span className={t.accent}>{t.label}</span>
                    <span className="text-2xs text-term-dim">{t.note}</span>
                  </span>
                  <span className="self-center text-right text-term-text">{pct(f)}</span>
                  <span className="self-center text-right text-term-muted">
                    {hasAccount ? `$${fmtPrice(acct * f)}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Edge diagnostics */}
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Expectancy"
              value={`${fmtSigned(result.expectancy)} R`}
              accent={changeClass(result.expectancy)}
            />
            <Stat label="Breakeven win" value={pct(result.breakevenWin, 1)} />
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            {result.edge
              ? `Full Kelly maximizes long-run growth but is volatile — most traders bet half or less. At a ${payoff || '—'}:1 payoff you only need to win ${pct(result.breakevenWin, 1)} to break even.`
              : `No positive edge at this win rate and payoff, so the growth-optimal bet is zero. You'd need to win above ${pct(result.breakevenWin, 1)} at a ${payoff || '—'}:1 payoff to have an edge.`}
          </p>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          Enter a win rate (0–100%) and a payoff ratio above 0 to size the bet.
        </div>
      )}
    </div>
  );
}
