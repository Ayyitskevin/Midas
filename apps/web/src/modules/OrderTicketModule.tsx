import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact, changeClass } from '@/lib/format';
import { previewOrder, type OrderType } from '@/lib/orderPreview';
import { emitAccountChange, usePricePick } from '@/lib/accountBus';
import { quickSizeAmount, capBlockReason } from '@/lib/quickSize';
import { describeOrderTrack, isTerminalOrderStatus } from '@/lib/orderTrack';
import { useFillBaselines } from '@/store/useFillBaselines';
import type { Level, Side } from '@/lib/slippage';
import type { PlacedOrder } from '@midas/shared';
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
 * resting).
 *
 * Placement is OFF by default: the panel previews only, and the place button is
 * disabled, unless the operator has explicitly enabled live trading on the server
 * (MIDAS_TRADING_ENABLED + trade keys + auth). When live, the button arms a
 * two-step confirm and the panel shows a red LIVE banner so the mode is never
 * ambiguous — every order is validated and notional-capped server-side.
 */
export function OrderTicketModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [limit, setLimit] = useState('');
  const [feeBps, setFeeBps] = useState('5');

  // Live-placement state. Only reachable when the server reports trading enabled.
  const [armed, setArmed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // Latest lookup of the placed order — drives the placed → partial → filled/
  // canceled progression shown after placement.
  const [tracked, setTracked] = useState<PlacedOrder | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol!, 100, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );
  const trading = useFetch((signal) => api.tradingStatus(signal), [], { intervalMs: 60_000 });
  const live = trading.data?.enabled ?? false;
  // Balances power the %-of-balance quick-size buttons (synthetic in demo mode).
  const balances = useFetch((signal) => api.balances(signal), [], { intervalMs: 30_000 });
  const freeOf = (asset: string): number =>
    balances.data?.balances.find((b) => b.asset === asset.toUpperCase())?.free ?? 0;

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

  // Any change to the order invalidates a pending confirm or a prior result, so
  // the user can never confirm a different order than the one shown.
  useEffect(() => {
    setArmed(false);
    setPlaceError(null);
    setPlaced(null);
  }, [symbol, side, type, amount, limit]);

  // A click on a linked order-book level takes that price as the limit.
  usePricePick((pick) => {
    if (!panel.link || pick.group !== panel.link) return;
    setType('limit');
    setLimit(String(pick.price));
  });

  // Track a placed order to its terminal state: a read-only 3s lookup poll
  // that stops on filled/canceled (or when the user starts a new order).
  useEffect(() => {
    setTracked(null);
    if (!placed || placed.id === '—' || isTerminalOrderStatus(placed.status)) return;
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const o = await api.getOrder(placed.id, placed.symbol, controller.signal);
        if (cancelled) return;
        setTracked(o);
        if (isTerminalOrderStatus(o.status)) {
          clearInterval(timer);
          emitAccountChange(); // final state reached — refresh ORD/FILLS/BAL
        }
      } catch {
        /* lookup unavailable this tick — keep the last known state */
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [placed]);

  async function doPlace() {
    if (!preview.ok || !symbol) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await api.placeOrder({
        symbol,
        side,
        type,
        amount: num(amount),
        price: type === 'limit' ? num(limit) : null,
        clientOrderId: crypto.randomUUID(),
      });
      setPlaced(res);
      setArmed(false);
      // Remember the preview's estimated avg price so FILLS/XQL can show
      // realized-vs-predicted slippage once executions arrive.
      if (res.id && res.id !== '—' && preview.avgPrice != null) {
        useFillBaselines.getState().record({
          orderId: res.id,
          symbol,
          side,
          estPrice: preview.avgPrice,
          at: Date.now(),
        });
      }
      emitAccountChange(); // open ORD/BAL/POSN panels refresh immediately
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : 'Order failed.');
    } finally {
      setPlacing(false);
    }
  }

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

  // Reference price for sizing + client-side cap warnings: the limit price when
  // set, else the touch. The server re-prices and re-checks authoritatively.
  const limitNum = num(limit);
  const priceRef =
    type === 'limit' ? (Number.isFinite(limitNum) && limitNum > 0 ? limitNum : null) : preview.bestPrice;
  const estNotional = preview.ok && priceRef != null ? preview.amount * priceRef : null;
  const capBlock = live ? capBlockReason(estNotional, trading.data ?? null) : null;

  const applyQuickSize = (fraction: number) => {
    const amt = quickSizeAmount(side, fraction, freeOf(base), freeOf(quote), priceRef ?? 0);
    if (amt != null && amt > 0) setAmount(String(Number(amt.toFixed(6))));
  };

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Mode banner: red LIVE when trading is enabled, amber PREVIEW otherwise. */}
      {live ? (
        <div className="flex items-start gap-2 rounded-sm border border-term-down/50 bg-term-down/10 px-2 py-1.5">
          <span className="rounded-sm bg-term-down/25 px-1.5 py-0.5 text-2xs font-semibold text-term-down">● LIVE</span>
          <span className="text-2xs leading-relaxed text-term-text">
            Live trading is ENABLED — orders you confirm here are real and execute on{' '}
            {trading.data?.source ?? 'the exchange'}.
            {trading.data?.maxOrderUsd != null ? ` Per-order cap $${fmtCompact(trading.data.maxOrderUsd)}.` : ''}
            {trading.data?.dailyCapUsd != null
              ? ` Today $${fmtCompact(trading.data.dailyUsedUsd)} of $${fmtCompact(trading.data.dailyCapUsd)} used.`
              : ''}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-sm border border-term-amber/40 bg-term-amber/10 px-2 py-1.5">
          <span className="rounded-sm bg-term-amber/20 px-1.5 py-0.5 text-2xs font-semibold text-term-amber">
            PREVIEW ONLY
          </span>
          <span className="text-2xs leading-relaxed text-term-text">
            Midas builds and checks this order against the live book but never submits it — placement is disabled until
            live trading is explicitly enabled on the server.
          </span>
        </div>
      )}

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

      {/* %-of-balance quick sizing: a sell sizes from free base, a buy from free quote at the ref price. */}
      <div className="flex items-center gap-1 text-2xs text-term-dim">
        <span>
          size from balance ({side === 'sell' ? base : quote} {fmtCompact(freeOf(side === 'sell' ? base : quote))})
        </span>
        {[0.25, 0.5, 1].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => applyQuickSize(f)}
            disabled={!balances.data || (side === 'buy' && priceRef == null)}
            className="rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted hover:border-term-amber/50 hover:text-term-amber disabled:opacity-40"
            title={side === 'buy' && priceRef == null ? 'Needs a limit price or a live touch price' : undefined}
          >
            {f === 1 ? 'MAX' : `${f * 100}%`}
          </button>
        ))}
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

      {/* Placement — disabled unless live trading is enabled on the server. */}
      {!live ? (
        <button
          type="button"
          disabled
          title={trading.data?.reason ?? 'Live trading is disabled — preview only.'}
          className="cursor-not-allowed rounded-sm border border-term-border bg-term-panel/40 py-1.5 text-2xs font-semibold uppercase tracking-wide text-term-dim opacity-70"
        >
          Place order — disabled (preview only)
        </button>
      ) : placed ? (
        (() => {
          const track = describeOrderTrack(tracked ?? placed);
          const boxCls =
            track.done && track.tone === 'down'
              ? 'border-term-down/50 bg-term-down/10'
              : 'border-term-up/50 bg-term-up/10';
          const toneCls =
            track.tone === 'up' ? 'text-term-up' : track.tone === 'down' ? 'text-term-down' : 'text-term-text';
          return (
            <div className={`rounded-sm border p-2 ${boxCls}`}>
              <div className="flex items-center justify-between">
                <span className={`text-2xs font-semibold ${track.done ? toneCls : 'text-term-up'}`}>
                  {track.done
                    ? track.tone === 'up'
                      ? '✓ Order filled (live)'
                      : '✖ Order ended (live)'
                    : '✓ Order placed (live)'}
                </span>
                {!track.done && <span className="text-2xs text-term-dim">tracking…</span>}
              </div>
              <Row label="ID">{placed.id}</Row>
              <Row label="Status">
                <span className={toneCls}>{track.label}</span>
              </Row>
              {track.progress != null && (
                <div className="mt-1 h-1 overflow-hidden rounded-sm bg-term-bg/60">
                  <div
                    className={`h-full ${track.tone === 'down' ? 'bg-term-down/60' : 'bg-term-up/60'}`}
                    style={{ width: `${Math.round(track.progress * 100)}%` }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setPlaced(null)}
                className="mt-1 w-full rounded-sm border border-term-border py-1 text-2xs uppercase text-term-muted hover:text-term-text"
              >
                New order
              </button>
            </div>
          );
        })()
      ) : armed ? (
        <div className="rounded-sm border border-term-down/50 bg-term-down/5 p-2">
          <div className="mb-1.5 text-2xs leading-relaxed text-term-text">
            Confirm a <span className={`font-semibold ${sideUp ? 'text-term-up' : 'text-term-down'}`}>LIVE {side} {type}</span>{' '}
            of {amount} {base}
            {type === 'limit' ? ` @ ${limit} ${quote}` : ' at market'} on {trading.data?.source ?? 'the exchange'}.
          </div>
          {/* What you're about to do, in numbers — est. fill, cash and cap usage. */}
          <div className="mb-1.5 rounded-sm bg-term-bg/40 px-1.5 py-1 font-mono text-2xs text-term-muted">
            est. fill {preview.avgPrice == null ? '—' : fmtPrice(preview.avgPrice)} · {sideUp ? 'cost' : 'proceeds'}{' '}
            {fmtCompact(preview.cashValue)} {quote} · fee {fmtCompact(preview.fee)}
            {trading.data?.dailyCapUsd != null && estNotional != null
              ? ` · today after: $${fmtCompact(trading.data.dailyUsedUsd + estNotional)} / $${fmtCompact(trading.data.dailyCapUsd)}`
              : ''}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={placing}
              className="flex-1 rounded-sm border border-term-border py-1 text-2xs uppercase text-term-muted hover:text-term-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doPlace}
              disabled={placing}
              className={`flex-1 rounded-sm border py-1 text-2xs font-semibold uppercase disabled:opacity-50 ${
                sideUp
                  ? 'border-term-up/60 bg-term-up/20 text-term-up hover:bg-term-up/30'
                  : 'border-term-down/60 bg-term-down/20 text-term-down hover:bg-term-down/30'
              }`}
            >
              {placing ? 'Placing…' : `Confirm LIVE ${side}`}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          disabled={!preview.ok || placing || capBlock != null}
          className={`rounded-sm py-1.5 text-2xs font-semibold uppercase tracking-wide ${
            preview.ok && capBlock == null
              ? sideUp
                ? 'border border-term-up/50 bg-term-up/15 text-term-up hover:bg-term-up/25'
                : 'border border-term-down/50 bg-term-down/15 text-term-down hover:bg-term-down/25'
              : 'cursor-not-allowed border border-term-border bg-term-panel/40 text-term-dim opacity-70'
          }`}
        >
          Review &amp; place (LIVE)
        </button>
      )}

      {capBlock && (
        <div className="rounded-sm border border-term-amber/40 bg-term-amber/10 px-2 py-1 text-2xs text-term-amber">
          ⚠ {capBlock}
        </div>
      )}

      {placeError && <div className="rounded-sm border border-term-down/40 bg-term-down/10 px-2 py-1 text-2xs text-term-down">⚠ {placeError}</div>}

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Walks the live L2 book to estimate the fill. Snapshot depth only; gross of funding. The preview is an estimate,
        not a routed quote.
      </p>
    </div>
  );
}
