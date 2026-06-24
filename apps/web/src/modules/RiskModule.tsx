import { useMemo, useState, type ReactNode } from 'react';
import { computePosition } from '@/lib/risk';
import { fmtPrice, fmtCompact } from '@/lib/format';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/** Best-effort base asset from a pair symbol (BTC/USDT → BTC) for unit labels. */
function baseAsset(symbol?: string | null): string {
  if (!symbol) return 'units';
  const base = symbol.toUpperCase().split(/[/\-:]/)[0];
  return base || 'units';
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

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function RiskModule({ panel }: ModuleProps) {
  const [account, setAccount] = useState('10000');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [leverage, setLeverage] = useState('');

  const result = useMemo(
    () =>
      computePosition({
        accountSize: num(account),
        riskPct: num(riskPct),
        entryPrice: num(entry),
        stopPrice: num(stop),
        leverage: leverage.trim() === '' ? null : num(leverage),
      }),
    [account, riskPct, entry, stop, leverage],
  );

  const unit = baseAsset(panel.symbol);
  const sideAccent = result.side === 'short' ? 'text-term-down' : 'text-term-up';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Account" value={account} onChange={setAccount} suffix="$" placeholder="10000" />
        <Field label="Risk" value={riskPct} onChange={setRiskPct} suffix="%" placeholder="1" />
        <Field label="Entry" value={entry} onChange={setEntry} placeholder="price" />
        <Field label="Stop" value={stop} onChange={setStop} placeholder="price" />
        <Field label="Leverage" value={leverage} onChange={setLeverage} suffix="×" placeholder="spot" />
        <div className="flex items-end justify-end pb-1">
          {result.valid && (
            <span
              className={`rounded-sm border border-current px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${sideAccent}`}
            >
              {result.side}
            </span>
          )}
        </div>
      </div>

      {/* Output */}
      {result.valid ? (
        <div className="flex flex-col gap-2">
          {/* Headline: position size */}
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="text-2xs uppercase tracking-wide text-term-dim">Position size</div>
            <div className="font-mono text-xl text-term-amber">
              {fmtPrice(result.positionSize, 4)}{' '}
              <span className="text-sm text-term-muted">{unit}</span>
            </div>
            <div className="text-2xs text-term-muted">
              ≈ ${fmtCompact(result.notional)} notional · {result.accountLeverage.toFixed(2)}× account
            </div>
          </div>

          {/* Key stats */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Risk amount" value={`$${fmtPrice(result.riskAmount)}`} accent="text-term-down" />
            <Stat label="Stop distance" value={`${result.stopDistancePct.toFixed(2)}%`} />
            {result.marginRequired != null && (
              <Stat label="Margin req." value={`$${fmtPrice(result.marginRequired)}`} />
            )}
            {result.liqPrice != null && (
              <Stat
                label={`Liq. price (−${result.liqDistancePct?.toFixed(1)}%)`}
                value={fmtPrice(result.liqPrice)}
                accent="text-term-down"
              />
            )}
          </div>

          {/* Reward targets */}
          <div className="rounded-sm border border-term-border">
            <div className="grid grid-cols-3 gap-1 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
              <span>Target</span>
              <span className="text-right">Price</span>
              <span className="text-right">Profit</span>
            </div>
            {result.targets.map((t) => (
              <div key={t.r} className="grid grid-cols-3 gap-1 px-2 py-1 font-mono text-xs">
                <span className="text-term-muted">{t.r}R</span>
                <span className="text-right text-term-text">{fmtPrice(t.price)}</span>
                <span className="text-right text-term-up">+${fmtPrice(t.profit)}</span>
              </div>
            ))}
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            Size puts exactly {riskPct || '—'}% of the account at risk if the stop fills. Liquidation is a
            rough isolated-margin estimate — it ignores maintenance margin and fees.
          </p>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          {entry.trim() === '' || stop.trim() === ''
            ? 'Enter an entry and stop price to size the trade.'
            : result.reason}
        </div>
      )}
    </div>
  );
}
