import { useMemo, useState, type ReactNode } from 'react';
import { computePnl, type TradeSide } from '@/lib/pnl';
import { fmtPrice, fmtCompact, changeClass } from '@/lib/format';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

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

function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
      {hint && <span className="text-2xs text-term-muted">{hint}</span>}
    </div>
  );
}

const money = (v: number): string => `${v >= 0 ? '+' : '−'}$${fmtPrice(Math.abs(v))}`;

export function PnlModule(_props: ModuleProps) {
  const [side, setSide] = useState<TradeSide>('long');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState('');
  const [entryFee, setEntryFee] = useState('0.05');
  const [exitFee, setExitFee] = useState('0.05');

  const result = useMemo(
    () =>
      computePnl({
        side,
        entry: num(entry),
        exit: num(exit),
        size: num(size),
        entryFeePct: num(entryFee) || 0,
        exitFeePct: num(exitFee) || 0,
        leverage: leverage.trim() === '' ? null : num(leverage),
      }),
    [side, entry, exit, size, leverage, entryFee, exitFee],
  );

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Side */}
      <div className="flex overflow-hidden self-start rounded-sm border border-term-border">
        {(['long', 'short'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`px-3 py-0.5 text-2xs uppercase ${
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

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Entry" value={entry} onChange={setEntry} placeholder="price" />
        <Field label="Exit" value={exit} onChange={setExit} placeholder="price" />
        <Field label="Size" value={size} onChange={setSize} placeholder="units" />
        <Field label="Leverage" value={leverage} onChange={setLeverage} suffix="×" placeholder="spot" />
        <Field label="Entry fee" value={entryFee} onChange={setEntryFee} suffix="%" />
        <Field label="Exit fee" value={exitFee} onChange={setExitFee} suffix="%" />
      </div>

      {/* Output */}
      {result.valid ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="text-2xs uppercase tracking-wide text-term-dim">Net P&amp;L</div>
            <div className={`font-mono text-xl ${changeClass(result.netPnl)}`}>{money(result.netPnl)}</div>
            <div className="text-2xs text-term-muted">
              {result.netRoePct >= 0 ? '+' : ''}
              {result.netRoePct.toFixed(2)}% ROE · ${fmtCompact(result.margin)} margin
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Gross P&L"
              value={money(result.grossPnl)}
              hint={`${result.grossRoePct >= 0 ? '+' : ''}${result.grossRoePct.toFixed(2)}% ROE`}
              accent={changeClass(result.grossPnl)}
            />
            <Stat
              label="Fees"
              value={`−$${fmtPrice(result.totalFees)}`}
              hint={`${fmtPrice(result.entryFee)} in · ${fmtPrice(result.exitFee)} out`}
              accent="text-term-down"
            />
            <Stat label="Break-even" value={fmtPrice(result.breakEvenPrice)} hint="exit, after fees" />
            <Stat label="Notional" value={`$${fmtCompact(result.entryNotional)}`} hint="at entry" />
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            ROE is measured against {result.margin === result.entryNotional ? 'full notional (spot)' : 'posted margin'}.
            Break-even is the exit that nets zero after both fees.
          </p>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          {entry.trim() === '' || exit.trim() === '' || size.trim() === ''
            ? 'Enter entry, exit and size to compute P&L.'
            : result.reason}
        </div>
      )}
    </div>
  );
}
