import { useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtCompact, changeClass } from '@/lib/format';
import { walkBook, cumulativeDepth, type Level, type FillResult, type SizeMode, type DepthPoint } from '@/lib/slippage';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
const round = (n: number): number => Math.round(n * 100) / 100;

function assets(symbol: string): { base: string; quote: string } {
  const [base, quote] = symbol.toUpperCase().split(/[/\-:]/);
  return { base: base || 'BASE', quote: quote || 'QUOTE' };
}

function FillCol({ title, fill, accent, base, quote }: { title: string; fill: FillResult; accent: string; base: string; quote: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-term-border bg-term-panel/60 p-2">
      <div className={`text-2xs font-semibold uppercase tracking-wide ${accent}`}>{title}</div>
      <div className="font-mono text-lg text-term-text">{fill.avgPrice == null ? '—' : fmtPrice(fill.avgPrice)}</div>
      <div className={`text-2xs ${fill.slippagePct == null ? 'text-term-dim' : changeClass(-Math.abs(fill.slippagePct))}`}>
        {fill.slippagePct == null ? 'no fill' : `${fill.slippagePct >= 0 ? '+' : ''}${fill.slippagePct.toFixed(3)}% slip`}
      </div>
      <div className="text-2xs text-term-muted">
        {fmtPrice(fill.filledBase, 4)} {base} · ${fmtCompact(fill.filledQuote)} {quote}
      </div>
      {fill.exhausted && <div className="text-2xs text-term-down">⚠ book exhausted</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      {children}
    </label>
  );
}

export function SlippageModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [size, setSize] = useState('');
  const [mode, setMode] = useState<SizeMode>('base');

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.orderbook(symbol!, 100, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );

  const bidLevels: Level[] = useMemo(() => (data?.bids ?? []).map((l) => ({ price: l.price, size: l.amount })), [data]);
  const askLevels: Level[] = useMemo(() => (data?.asks ?? []).map((l) => ({ price: l.price, size: l.amount })), [data]);

  const sizeNum = num(size);
  const target = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 0;
  const buy = walkBook(askLevels, 'buy', target, mode);
  const sell = walkBook(bidLevels, 'sell', target, mode);

  // Depth curve (near-touch levels each side).
  const depth = useMemo(() => {
    const bids = cumulativeDepth(bidLevels).slice(0, 50);
    const asks = cumulativeDepth(askLevels).slice(0, 50);
    const bidsAsc = [...bids].reverse(); // ascending price for left→right drawing
    const prices = [...bidsAsc, ...asks].map((d) => d.price);
    if (prices.length < 2) return null;
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const maxCum = Math.max(1, ...bids.map((d) => d.cum), ...asks.map((d) => d.cum));
    const W = 240;
    const H = 70;
    const pad = 2;
    const xAt = (p: number) => ((p - lo) / (hi - lo || 1)) * W;
    const yAt = (c: number) => H - pad - (c / maxCum) * (H - pad * 2);
    const area = (pts: DepthPoint[]) => {
      if (pts.length === 0) return '';
      const top = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(xAt(p.price))} ${round(yAt(p.cum))}`).join(' ');
      return `${top} L${round(xAt(pts[pts.length - 1].price))} ${H} L${round(xAt(pts[0].price))} ${H} Z`;
    };
    // The mid line only exists when the book has both sides. A one-sided book
    // (all bids or all asks — still ≥2 prices, so it passes the guard above)
    // would leave one operand undefined → NaN → an invalid SVG x1="NaN". Emit
    // midX only when both best levels are present.
    const bestBid = bidsAsc[bidsAsc.length - 1]?.price;
    const bestAsk = asks[0]?.price;
    const midX =
      bestBid != null && bestAsk != null ? round(xAt((bestBid + bestAsk) / 2)) : null;
    return { W, H, bidPath: area(bidsAsc), askPath: area(asks), midX };
  }, [bidLevels, askLevels]);

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT SLIP</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading book" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const { base, quote } = assets(symbol);
  const unit = mode === 'base' ? base : quote;

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-end gap-2">
        <Field label={`Order size (${unit})`}>
          <input
            type="number"
            inputMode="decimal"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder={mode === 'base' ? `size in ${base}` : `notional in ${quote}`}
            className="w-full rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
          />
        </Field>
        <div className="flex shrink-0 overflow-hidden rounded-sm border border-term-border">
          {(['base', 'quote'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2 py-1 text-2xs uppercase ${mode === m ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'}`}
            >
              {m === 'base' ? base : quote}
            </button>
          ))}
        </div>
      </div>

      {target > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <FillCol title="Buy (market)" fill={buy} accent="text-term-up" base={base} quote={quote} />
          <FillCol title="Sell (market)" fill={sell} accent="text-term-down" base={base} quote={quote} />
        </div>
      ) : (
        <div className="rounded-sm border border-term-border bg-term-panel/40 px-3 py-3 text-center text-2xs text-term-muted">
          Enter an order size to estimate the average fill and slippage.
        </div>
      )}

      {depth && (
        <div className="rounded-sm border border-term-border p-2">
          <div className="mb-1 text-2xs text-term-dim">Depth to fill · cumulative size</div>
          <svg width="100%" height={depth.H} viewBox={`0 0 ${depth.W} ${depth.H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={depth.bidPath} className="text-term-up" fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={depth.askPath} className="text-term-down" fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {depth.midX != null && (
              <line x1={depth.midX} y1={0} x2={depth.midX} y2={depth.H} className="text-term-dim" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        </div>
      )}

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Walks the live L2 book: a market buy lifts asks, a sell hits bids. Slippage is the average fill vs the touch.
        Gross of fees; snapshot depth only.
      </p>
    </div>
  );
}
