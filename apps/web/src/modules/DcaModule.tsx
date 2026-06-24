import { useMemo, useState, type ReactNode } from 'react';
import { computeDca, qtyToReachAverage, type DcaSide } from '@/lib/dca';
import { fmtPrice, fmtCompact, changeClass } from '@/lib/format';
import type { ModuleProps } from './types';

/** Parse a form string to a number; blank becomes NaN so the calc rejects it. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

/** Best-effort base asset from a pair symbol (BTC/USDT → BTC) for unit labels. */
function baseAsset(symbol?: string | null): string {
  if (!symbol) return 'units';
  const base = symbol.toUpperCase().split(/[/\-:]/)[0];
  return base || 'units';
}

interface LegRow {
  price: string;
  qty: string;
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
    />
  );
}

export function DcaModule({ panel }: ModuleProps) {
  const [side, setSide] = useState<DcaSide>('long');
  const [rows, setRows] = useState<LegRow[]>([
    { price: '', qty: '' },
    { price: '', qty: '' },
  ]);
  const [mark, setMark] = useState('');
  const [leverage, setLeverage] = useState('');
  const [targetAvg, setTargetAvg] = useState('');
  const [nextPrice, setNextPrice] = useState('');

  const result = useMemo(
    () =>
      computeDca({
        side,
        legs: rows.map((r) => ({ price: num(r.price), qty: num(r.qty) })),
        markPrice: mark.trim() === '' ? null : num(mark),
        leverage: leverage.trim() === '' ? null : num(leverage),
      }),
    [side, rows, mark, leverage],
  );

  const solve = useMemo(() => {
    if (!result.valid || targetAvg.trim() === '' || nextPrice.trim() === '') return null;
    return qtyToReachAverage(result.totalQty, result.avgPrice, num(nextPrice), num(targetAvg));
  }, [result, targetAvg, nextPrice]);

  const unit = baseAsset(panel.symbol);

  const setRow = (i: number, patch: Partial<LegRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { price: '', qty: '' }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i)));

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Side */}
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-sm border border-term-border">
          {(['long', 'short'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`px-2.5 py-0.5 text-2xs uppercase ${
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
        <span className="text-2xs text-term-dim">Average down / scale a position</span>
      </div>

      {/* Legs editor */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-2xs uppercase tracking-wide text-term-dim">
          <span className="flex-1">Price</span>
          <span className="flex-1">Size</span>
          <span className="w-5" />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <NumInput value={r.price} onChange={(v) => setRow(i, { price: v })} placeholder="price" />
            <NumInput value={r.qty} onChange={(v) => setRow(i, { qty: v })} placeholder="size" />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1}
              className="w-5 text-term-dim hover:text-term-down disabled:opacity-30"
              aria-label="Remove entry"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-sm border border-term-border px-2 py-0.5 text-2xs text-term-muted hover:text-term-text"
        >
          + Add entry
        </button>
      </div>

      {/* Results */}
      {result.valid ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
            <div className="text-2xs uppercase tracking-wide text-term-dim">Average entry · break-even</div>
            <div className="font-mono text-xl text-term-amber">{fmtPrice(result.avgPrice)}</div>
            <div className="text-2xs text-term-muted">
              {fmtPrice(result.totalQty, 4)} {unit} · ${fmtCompact(result.totalCost)} cost · {result.legCount}{' '}
              {result.legCount === 1 ? 'entry' : 'entries'}
            </div>
          </div>

          {/* Mark + leverage */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-2xs uppercase tracking-wide text-term-dim">Mark price</span>
              <NumInput value={mark} onChange={setMark} placeholder="current" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-2xs uppercase tracking-wide text-term-dim">Leverage</span>
              <NumInput value={leverage} onChange={setLeverage} placeholder="spot" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {result.markPnl != null && (
              <Stat
                label="Unrealized P&L"
                value={`${result.markPnl >= 0 ? '+' : '−'}$${fmtPrice(Math.abs(result.markPnl))}`}
                accent={changeClass(result.markPnl)}
              />
            )}
            {result.markPnlPct != null && (
              <Stat
                label="Return"
                value={`${result.markPnlPct >= 0 ? '+' : ''}${result.markPnlPct.toFixed(2)}%`}
                accent={changeClass(result.markPnlPct)}
              />
            )}
            {result.liqPrice != null && (
              <Stat
                label={`Liq. price (−${result.liqDistancePct?.toFixed(1)}%)`}
                value={fmtPrice(result.liqPrice)}
                accent="text-term-down"
              />
            )}
          </div>

          {/* "Bring average to" solver */}
          <div className="rounded-sm border border-term-border p-2">
            <div className="term-label mb-1">Bring average to…</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-2xs uppercase tracking-wide text-term-dim">Target avg</span>
                <NumInput value={targetAvg} onChange={setTargetAvg} placeholder="target" />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-2xs uppercase tracking-wide text-term-dim">Next-buy price</span>
                <NumInput value={nextPrice} onChange={setNextPrice} placeholder="price" />
              </label>
            </div>
            {solve &&
              (solve.valid ? (
                <div className="mt-1.5 text-xs text-term-text">
                  Buy{' '}
                  <span className="font-mono text-term-amber">
                    {fmtPrice(solve.qty, 4)} {unit}
                  </span>{' '}
                  @ {fmtPrice(num(nextPrice))} →{' '}
                  <span className="text-term-muted">
                    {fmtPrice(solve.resultingQty, 4)} {unit} @ {fmtPrice(solve.resultingAvg)}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 text-2xs text-term-down">{solve.reason}</div>
              ))}
          </div>

          <p className="px-1 text-2xs leading-relaxed text-term-dim">
            Average is size-weighted; break-even equals the average (fees aside). Liquidation is a rough
            isolated-margin estimate.
          </p>
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-4 text-center text-xs text-term-muted">
          {result.reason}
        </div>
      )}
    </div>
  );
}
