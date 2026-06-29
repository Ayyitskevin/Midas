import { useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact, changeClass } from '@/lib/format';
import { previewOrder, type OrderType } from '@/lib/orderPreview';
import type { Level, Side } from '@/lib/slippage';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

function assets(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.toUpperCase().split(/[/\-:]/);
  return { base: base || 'BASE', quote: quote || 'QUOTE' };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-2xs text-term-dim">{label}</span>
      <span className="font-mono text-2xs text-term-text">{children}</span>
    </div>
  );
}

const inputCls =
  'w-full rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60';

/**
 * TICKET — an order ticket that builds, validates and previews a market/limit
 * order against the live L2 book (average fill, fees, slippage, marketable vs
 * resting). The order-entry seam before live placement.
 *
 * Read-only and non-custodial: this previews only. There is no submit — Midas
 * never places orders or moves funds. (Live placement is a separate, explicitly
 * gated step that is not part of this build.)
 */
export function OrderTicketModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [limit, setLimit] = useState('');
  const [feeBps, setFeeBps] = useState('5');

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol!, 100, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );

  const bids: Level[] = useMemo(() => (data?.bids ?? []).map((l) => ({ price: l.price, size: l.amount })), [data]);
  const asks: Level[] = useMemo(() => (data?.asks ?? []).map((l) => ({ price: l.price, size: l.amount })), [data]);

  const preview = useMemo(
    () =>
      previewOrder(
        { bids, asks },
        { side, type, amount: num(amount), limitPrice: type === 'limit' ? num(limit) : null, feeBps: num(feeBps) },
      ),
    [bids, asks, side, type, amount, limit, feeBps],
  );

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT TICKET</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading book" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const { base, quote } = assets(symbol);
  const sideUp = side === 'buy';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Honesty banner: this is a preview, never a live order. */}
      <div className="flex items-start gap-2 rounded-sm border border-term-amber/40 bg-term-amber/10 px-2 py-1.5">
        <span className="rounded-sm bg-term-amber/20 px-1.5 py-0.5 text-2xs font-semibold text-term-amber">
          PREVIEW ONLY
        </span>
        <span className="text-2xs leading-relaxed text-term-text">
          Midas builds and checks this order against the live book but never submits it — placement is non-custodial and
          disabled.
        </span>
      </div>

      {/* Side + type toggles */}
      <div className="flex gap-2">
        <div className="flex flex-1 overflow-hidden rounded-sm border border-term-border">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`flex-1 py-1 text-2xs font-semibold uppercase ${
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
        <div className="flex flex-1 overflow-hidden rounded-sm border border-term-border">
          {(['market', 'limit'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-1 text-2xs uppercase ${
                type === t ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="flex items-end gap-2">
        <Field label={`Amount (${base})`}>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`size in ${base}`}
            className={inputCls}
          />
        </Field>
        {type === 'limit' && (
          <Field label={`Limit (${quote})`}>
            <input
              type="number"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={`price in ${quote}`}
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Fee bps">
          <input
            type="number"
            inputMode="decimal"
            value={feeBps}
            onChange={(e) => setFeeBps(e.target.value)}
            placeholder="5"
            className={inputCls}
          />
        </Field>
      </div>

      {/* Validation errors, or the preview */}
      {!preview.ok ? (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-3 text-center text-2xs text-term-muted">
          {preview.errors[0] ?? 'Enter the order details to preview the fill.'}
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className={`text-2xs font-semibold uppercase ${sideUp ? 'text-term-up' : 'text-term-down'}`}>
              {side} {type}
            </span>
            <span
              className={`rounded-sm px-1.5 py-0.5 text-2xs ${
                preview.marketable ? 'bg-term-up/15 text-term-up' : 'bg-term-amber/15 text-term-amber'
              }`}
            >
              {preview.marketable
                ? preview.unfilledBase > 0
                  ? 'takes + rests'
                  : 'takes now'
                : `rests @ ${preview.restingPrice == null ? '—' : fmtPrice(preview.restingPrice)}`}
            </span>
          </div>
          <Row label="Avg fill">{preview.avgPrice == null ? '—' : fmtPrice(preview.avgPrice)}</Row>
          <Row label="Touch / worst">
            {preview.bestPrice == null ? '—' : fmtPrice(preview.bestPrice)}
            {preview.worstPrice != null ? ` → ${fmtPrice(preview.worstPrice)}` : ''}
          </Row>
          <Row label="Slippage">
            <span className={preview.slippagePct == null ? 'text-term-dim' : changeClass(-Math.abs(preview.slippagePct))}>
              {preview.slippagePct == null ? '—' : `${preview.slippagePct >= 0 ? '+' : ''}${preview.slippagePct.toFixed(3)}%`}
            </span>
          </Row>
          <Row label={`Filled / rests (${base})`}>
            {fmtPrice(preview.filledBase, 4)} / {fmtPrice(preview.unfilledBase, 4)}
          </Row>
          <Row label={`Notional (${quote})`}>{fmtCompact(preview.filledQuote)}</Row>
          <Row label={`Fee (${preview.feeBps}bps)`}>{fmtCompact(preview.fee)}</Row>
          <div className="mt-1 border-t border-term-border pt-1">
            <Row label={sideUp ? `Total cost (${quote})` : `Net proceeds (${quote})`}>
              <span className="text-sm font-semibold">{fmtCompact(preview.cashValue)}</span>
            </Row>
          </div>
          {preview.exhausted && <div className="mt-1 text-2xs text-term-down">⚠ book exhausted — order larger than resting liquidity</div>}
        </div>
      )}

      {/* The placement affordance — deliberately disabled (read-only build). */}
      <button
        type="button"
        disabled
        title="Order placement is disabled — Midas is read-only and non-custodial."
        className="cursor-not-allowed rounded-sm border border-term-border bg-term-panel/40 py-1.5 text-2xs font-semibold uppercase tracking-wide text-term-dim opacity-70"
      >
        Place order — disabled (read-only)
      </button>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Walks the live L2 book to estimate the fill. Snapshot depth only; gross of funding. A preview, not a routed
        quote — and never an order.
      </p>
    </div>
  );
}
