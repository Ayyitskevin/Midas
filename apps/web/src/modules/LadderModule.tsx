import { useMemo, useState } from 'react';
import { ladder, type LadderWeighting } from '@/lib/ladder';
import { fmtPrice, fmtCompact } from '@/lib/format';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/** Best-effort base asset from a pair symbol (BTC/USDT → BTC) for unit labels. */
function baseAsset(symbol?: string | null): string {
  if (!symbol) return 'units';
  const b = symbol.toUpperCase().split(/[/\-:]/)[0];
  return b || 'units';
}

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

function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`no-drag flex-1 rounded-sm border px-1.5 py-1 text-2xs uppercase tracking-wide ${
            value === o.value
              ? 'border-term-amber/60 bg-term-amber/15 text-term-amber'
              : 'border-term-border text-term-muted hover:text-term-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LadderModule({ panel }: ModuleProps) {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [weighting, setWeighting] = useState<LadderWeighting>('linear');
  const [high, setHigh] = useState('100');
  const [low, setLow] = useState('90');
  const [rungs, setRungs] = useState('5');
  const [budget, setBudget] = useState('10000');

  const plan = useMemo(
    () =>
      ladder({
        priceHigh: num(high),
        priceLow: num(low),
        rungs: num(rungs),
        budget: num(budget),
        weighting,
        heavyLow: side === 'long',
      }),
    [high, low, rungs, budget, weighting, side],
  );

  const unit = baseAsset(panel.symbol);
  const maxWeight = plan.valid ? Math.max(...plan.rungs.map((r) => r.weight)) : 0;
  const sideAccent = side === 'short' ? 'text-term-down' : 'text-term-up';
  const barColor = side === 'short' ? 'bg-term-down/15' : 'bg-term-up/15';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Side + weighting */}
      <div className="grid grid-cols-2 gap-2">
        <Seg
          options={[
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
          value={side}
          onChange={setSide}
        />
        <Seg
          options={[
            { value: 'flat', label: 'Flat' },
            { value: 'linear', label: 'Linear' },
            { value: 'geometric', label: 'Geo' },
          ]}
          value={weighting}
          onChange={setWeighting}
        />
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="High" value={high} onChange={setHigh} placeholder="price" />
        <Field label="Low" value={low} onChange={setLow} placeholder="price" />
        <Field label="Rungs" value={rungs} onChange={setRungs} placeholder="5" />
        <Field label="Budget" value={budget} onChange={setBudget} suffix="$" placeholder="10000" />
      </div>

      {plan.valid ? (
        <div className="flex flex-col gap-2">
          {/* Headline: blended average entry */}
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-term-dim">Average entry</span>
              <span className={`text-2xs font-semibold uppercase tracking-wide ${sideAccent}`}>
                {side} · {weighting}
              </span>
            </div>
            <div className="font-mono text-xl text-term-amber">{fmtPrice(plan.avgEntry)}</div>
            <div className="text-2xs text-term-muted">
              {fmtPrice(plan.totalQty, 4)} {unit} · ${fmtCompact(plan.totalNotional)} across {plan.rungs.length} rungs
            </div>
          </div>

          {/* Rung allocation table */}
          <div className="rounded-sm border border-term-border">
            <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
              <span>#</span>
              <span className="text-right">Price</span>
              <span className="text-right">Cash</span>
              <span className="text-right">Qty</span>
            </div>
            {plan.rungs.map((r, i) => (
              <div key={i} className="relative border-b border-term-border/40 last:border-b-0">
                <div
                  className={`absolute inset-y-0 left-0 ${barColor}`}
                  style={{ width: `${maxWeight > 0 ? (r.weight / maxWeight) * 100 : 0}%` }}
                />
                <div className="relative grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-2 py-1 font-mono text-xs tabular-nums">
                  <span className="text-term-dim">{i + 1}</span>
                  <span className="text-right text-term-text">{fmtPrice(r.price)}</span>
                  <span className="text-right text-term-muted">
                    ${fmtCompact(r.notional)}
                    <span className="ml-1 text-2xs text-term-dim">{(r.weight * 100).toFixed(0)}%</span>
                  </span>
                  <span className="text-right text-term-text">{fmtPrice(r.qty, 4)}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            {plan.rungs.length} limit orders spread evenly from {fmtPrice(num(high))} to {fmtPrice(num(low))}, the{' '}
            {weighting === 'flat' ? 'same cash' : 'heavier cash'} loaded toward the {side === 'long' ? 'low' : 'high'}.
            The blended fill assumes every rung executes.
          </p>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          Set a high and low price (high ≥ low), at least one rung and a positive budget to plan the ladder.
        </div>
      )}
    </div>
  );
}
