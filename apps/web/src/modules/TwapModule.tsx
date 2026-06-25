import { useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact } from '@/lib/format';
import type { Level, Side } from '@/lib/slippage';
import { planTwap, type TwapPlan } from '@/lib/twap';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
const MAX_SLICES = 96;
const SCHEDULE_ROWS = 20;

function assets(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.toUpperCase().split(/[/\-:]/);
  return { base: base || 'BASE', quote: quote || 'QUOTE' };
}

function fmtOffset(sec: number): string {
  if (sec <= 0) return 'now';
  if (sec % 60 === 0) return `+${sec / 60}m`;
  return `+${sec}s`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60';

function Cmp({
  title,
  accent,
  avg,
  bps,
  filled,
  unit,
  exhausted,
}: {
  title: string;
  accent: string;
  avg: number | null;
  bps: number | null;
  filled: number;
  unit: string;
  exhausted: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-term-border bg-term-panel/60 p-2">
      <div className={`text-2xs font-semibold uppercase tracking-wide ${accent}`}>{title}</div>
      <div className="font-mono text-lg text-term-text">{avg == null ? '—' : fmtPrice(avg)}</div>
      <div className="text-2xs text-term-muted">{bps == null ? 'no fill' : `${bps.toFixed(1)} bps vs touch`}</div>
      <div className="text-2xs text-term-dim">
        fills {fmtPrice(filled, 4)} {unit}
        {exhausted && <span className="text-term-down"> · ⚠ exhausted</span>}
      </div>
    </div>
  );
}

export function TwapModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [side, setSide] = useState<Side>('buy');
  const [sizeStr, setSizeStr] = useState('');
  const [slicesStr, setSlicesStr] = useState('6');
  const [intervalStr, setIntervalStr] = useState('5');

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol!, 100, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );

  const levels: Level[] = useMemo(() => {
    const side$ = side === 'buy' ? data?.asks : data?.bids;
    return (side$ ?? []).map((l) => ({ price: l.price, size: l.amount }));
  }, [data, side]);

  const slices = Math.max(1, Math.min(MAX_SLICES, Math.floor(num(slicesStr)) || 1));
  const plan: TwapPlan | null = useMemo(() => {
    const total = num(sizeStr);
    if (!(total > 0) || levels.length === 0) return null;
    return planTwap({ levels, side, totalBase: total, slices, intervalSec: (num(intervalStr) || 0) * 60 });
  }, [levels, side, sizeStr, slices, intervalStr]);

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT TWAP</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading book" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const { base, quote } = assets(symbol);
  const saving = plan?.savingsBps ?? null;
  const hasSaving = saving != null && saving > 0.05;

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-sm border border-term-border">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`px-2 py-1 text-2xs uppercase ${
                side === s
                  ? s === 'buy'
                    ? 'bg-term-up/20 text-term-up'
                    : 'bg-term-down/20 text-term-down'
                  : 'text-term-muted hover:text-term-text'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-2xs text-term-dim">walk {side === 'buy' ? 'asks' : 'bids'} · {base}/{quote}</span>
      </div>

      <div className="flex items-end gap-2">
        <Field label={`Order size (${base})`}>
          <input
            type="number"
            inputMode="decimal"
            value={sizeStr}
            onChange={(e) => setSizeStr(e.target.value)}
            placeholder={`size in ${base}`}
            className={inputCls}
          />
        </Field>
        <Field label="Slices">
          <input type="number" inputMode="numeric" value={slicesStr} onChange={(e) => setSlicesStr(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Interval (min)">
          <input type="number" inputMode="decimal" value={intervalStr} onChange={(e) => setIntervalStr(e.target.value)} className={inputCls} />
        </Field>
      </div>

      {plan ? (
        <>
          <div
            className={`rounded-sm border px-3 py-2 ${
              hasSaving ? 'border-term-up/30 bg-term-up/5' : 'border-term-border bg-term-panel/40'
            }`}
          >
            {hasSaving ? (
              <div className="text-xs text-term-text">
                <span className="font-semibold text-term-up">TWAP saves ~{saving!.toFixed(1)} bps</span>
                {plan.savingsQuote != null && (
                  <span className="text-term-muted"> · ≈ {fmtCompact(plan.savingsQuote)} {quote} on this order</span>
                )}
                <span className="text-term-dim"> · {plan.slices}× over {Math.round(plan.durationSec / 60)}m</span>
              </div>
            ) : (
              <div className="text-2xs text-term-muted">
                Negligible impact saving — this size barely moves the book. TWAP mainly reduces timing footprint here.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Cmp
              title="Aggressive (now)"
              accent="text-term-down"
              avg={plan.aggressive.avgPrice}
              bps={plan.aggressiveBps}
              filled={plan.aggressive.filledBase}
              unit={base}
              exhausted={plan.aggressive.exhausted}
            />
            <Cmp
              title={`TWAP (${plan.slices}×)`}
              accent="text-term-up"
              avg={plan.twapAvgPrice}
              bps={plan.twapBps}
              filled={plan.twapFilledBase}
              unit={base}
              exhausted={plan.twapExhausted}
            />
          </div>

          <div className="rounded-sm border border-term-border">
            <div className="grid grid-cols-4 gap-1 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
              <span>#</span>
              <span>When</span>
              <span className="text-right">Size ({base})</span>
              <span className="text-right">Cum</span>
            </div>
            <div className="scroll-term max-h-48 overflow-y-auto">
              {plan.schedule.slice(0, SCHEDULE_ROWS).map((s) => (
                <div key={s.index} className="grid grid-cols-4 gap-1 px-2 py-0.5 text-2xs tabular-nums">
                  <span className="text-term-muted">{s.index}</span>
                  <span className="text-term-dim">{fmtOffset(s.tOffsetSec)}</span>
                  <span className="text-right text-term-text">{fmtPrice(s.size, 4)}</span>
                  <span className="text-right text-term-muted">{fmtPrice(s.cumSize, 4)}</span>
                </div>
              ))}
              {plan.schedule.length > SCHEDULE_ROWS && (
                <div className="px-2 py-0.5 text-2xs text-term-dim">+{plan.schedule.length - SCHEDULE_ROWS} more slices…</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-3 text-center text-2xs text-term-muted">
          Enter an order size to plan the execution.
        </div>
      )}

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Compares filling the whole size now (deep into the book) vs. slicing it over time, assuming the book refills
        between slices. Best-case for impact — it ignores price drift / timing risk while you wait. Snapshot depth, gross of fees.
      </p>
    </div>
  );
}
