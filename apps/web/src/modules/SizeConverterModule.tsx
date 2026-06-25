import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact } from '@/lib/format';
import { convertSize, fieldValue, type SizeField, type SizeResult } from '@/lib/sizing';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

function baseAsset(symbol?: string | null): string {
  if (!symbol) return 'units';
  return symbol.toUpperCase().split(/[/\-:]/)[0] || 'units';
}
function quoteAsset(symbol?: string | null): string {
  if (!symbol) return 'USD';
  return symbol.toUpperCase().split(/[/\-:]/)[1] || 'USD';
}

/** Up to 8 significant digits, no trailing zeros — clean for crypto quantities. */
function trimNum(v: number): string {
  return Number(v.toPrecision(8)).toString();
}
function displayFor(r: SizeResult, f: SizeField): string {
  const v = fieldValue(r, f);
  if (!Number.isFinite(v)) return '';
  return f === 'qty' ? trimNum(v) : v.toFixed(2);
}

function Param({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
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

function LinkedField({
  id,
  label,
  suffix,
  canonical,
  valueStr,
  display,
  onEdit,
}: {
  id: SizeField;
  label: string;
  suffix: string;
  canonical: SizeField;
  valueStr: string;
  display: string;
  onEdit: (id: SizeField, raw: string) => void;
}) {
  const isCanon = canonical === id;
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <div
        className={`flex items-center gap-1 rounded-sm border bg-term-bg/40 px-1.5 py-1 focus-within:border-term-amber/60 ${
          isCanon ? 'border-term-amber/50' : 'border-term-border'
        }`}
      >
        <input
          type="number"
          inputMode="decimal"
          value={isCanon ? valueStr : display}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onEdit(id, e.target.value)}
          placeholder="0"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-term-text outline-none placeholder:text-term-dim"
        />
        <span className="shrink-0 text-2xs text-term-dim">{suffix}</span>
      </div>
    </label>
  );
}

export function SizeConverterModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  const { data: quote } = useFetch(
    (signal) => api.quote(symbol as string, signal),
    [symbol],
    { intervalMs: 5000, enabled: Boolean(symbol) },
  );
  const livePrice = quote?.price ?? NaN;

  const [field, setField] = useState<SizeField>('notional');
  const [valueStr, setValueStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [account, setAccount] = useState('10000');
  const [leverage, setLeverage] = useState('1');

  // Seed the price from the live quote, re-seeding on symbol change, but never
  // fighting a manual edit (only fills while the field is blank).
  useEffect(() => setPriceStr(''), [symbol]);
  useEffect(() => {
    if (Number.isFinite(livePrice)) setPriceStr((prev) => (prev === '' ? String(livePrice) : prev));
  }, [livePrice]);

  const result = useMemo(
    () =>
      convertSize({
        field,
        value: num(valueStr),
        price: num(priceStr),
        account: num(account),
        leverage: num(leverage),
      }),
    [field, valueStr, priceStr, account, leverage],
  );

  const onEdit = (id: SizeField, raw: string) => {
    setField(id);
    setValueStr(raw);
  };

  const base = baseAsset(symbol);
  const quoteCcy = quoteAsset(symbol);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2 text-xs">
      {/* Parameters */}
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-2xs uppercase tracking-wide text-term-dim">Price</span>
          <div className="flex items-center gap-1 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 focus-within:border-term-amber/60">
            <input
              type="number"
              inputMode="decimal"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              placeholder="price"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-term-text outline-none placeholder:text-term-dim"
            />
            <button
              type="button"
              onClick={() => Number.isFinite(livePrice) && setPriceStr(String(livePrice))}
              disabled={!Number.isFinite(livePrice)}
              title="Use the live price"
              className="shrink-0 rounded-sm px-1 text-2xs text-term-amber hover:bg-term-amber/15 disabled:text-term-dim"
            >
              ↺ live{Number.isFinite(livePrice) ? ` ${fmtPrice(livePrice)}` : ''}
            </button>
          </div>
        </label>
        <Param label="Account" value={account} onChange={setAccount} suffix={quoteCcy} placeholder="10000" />
        <Param label="Leverage" value={leverage} onChange={setLeverage} suffix="×" placeholder="1" />
      </div>

      <div className="border-t border-term-border/60" />

      {/* Linked converter — edit any one, the rest follow. */}
      <div className="grid grid-cols-2 gap-2">
        <LinkedField
          id="qty"
          label={`Quantity (${base})`}
          suffix={base}
          canonical={field}
          valueStr={valueStr}
          display={displayFor(result, 'qty')}
          onEdit={onEdit}
        />
        <LinkedField
          id="notional"
          label={`Notional (${quoteCcy})`}
          suffix={quoteCcy}
          canonical={field}
          valueStr={valueStr}
          display={displayFor(result, 'notional')}
          onEdit={onEdit}
        />
        <LinkedField
          id="pct"
          label="% of Account"
          suffix="%"
          canonical={field}
          valueStr={valueStr}
          display={displayFor(result, 'pct')}
          onEdit={onEdit}
        />
        <LinkedField
          id="margin"
          label={`Margin (${quoteCcy})`}
          suffix={quoteCcy}
          canonical={field}
          valueStr={valueStr}
          display={displayFor(result, 'margin')}
          onEdit={onEdit}
        />
      </div>

      {/* Quick % of account */}
      <div className="flex items-center gap-1">
        <span className="text-2xs text-term-dim">quick:</span>
        {[10, 25, 50, 100].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onEdit('pct', String(p))}
            className="rounded-sm border border-term-border px-1.5 py-0.5 text-2xs text-term-muted hover:border-term-amber hover:text-term-amber"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Recap */}
      {result.valid ? (
        <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2 font-mono text-xs text-term-text">
          {Number.isFinite(result.qty) ? trimNum(result.qty) : '—'}{' '}
          <span className="text-term-muted">{base}</span>
          {' ≈ '}
          {Number.isFinite(result.notional) ? `${fmtCompact(result.notional)} ${quoteCcy}` : '—'}
          {Number.isFinite(result.pct) && (
            <span className="text-term-muted"> · {result.pct.toFixed(1)}% acct</span>
          )}
          <span className="text-term-muted">
            {' · '}
            {fmtCompact(result.margin)} {quoteCcy} margin @ {result.leverage}×
          </span>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-3 text-center text-2xs text-term-muted">
          Enter a quantity, notional, % of account or margin to convert.
        </div>
      )}

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Edit any field — the others follow. The highlighted field is what you typed; price seeds from the
        live quote (↺ to resync). Margin = notional ÷ leverage (isolated, ignores fees).
      </p>
    </div>
  );
}
