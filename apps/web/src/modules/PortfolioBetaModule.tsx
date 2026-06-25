import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePortfolio } from '@/store/usePortfolio';
import { toReturns } from '@/lib/correlation';
import { computeBeta } from '@/lib/beta';
import { portfolioBeta, type PBetaInput } from '@/lib/portfolioBeta';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BENCH = 'BTC/USDT';
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

/** Signed dollar string, e.g. −$12.3K. */
const signedUsd = (v: number) => `${v < 0 ? '−' : ''}$${fmtCompact(Math.abs(v))}`;

/** Beta of a symbol's closes vs BTC's, or null when there isn't enough overlap. */
function betaFor(closes: number[], btc: number[]): number | null {
  const k = Math.min(closes.length, btc.length);
  if (k < 3) return null;
  const stat = computeBeta(toReturns(closes.slice(-k)), toReturns(btc.slice(-k)));
  return stat ? stat.beta : null;
}

export function PortfolioBetaModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const [tfIdx, setTfIdx] = useState(1); // default 90D
  const tf = TIMEFRAMES[tfIdx];

  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);
  const fetchSyms = useMemo(() => Array.from(new Set([BENCH, ...symbols])), [symbols]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(','), tf.interval, tf.range],
    { enabled: positions.length > 0 },
  );

  const { data: quotes } = useFetch((signal) => api.quotes(symbols, signal), [symbols.join(',')], {
    intervalMs: 10_000,
    enabled: symbols.length > 0,
  });

  const priceBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes ?? []) m.set(q.symbol, q.price);
    return m;
  }, [quotes]);

  const btcMissing = useMemo(
    () => Boolean(data) && !data!.find((d) => d.symbol === BENCH)?.closes.length,
    [data],
  );

  const result = useMemo(() => {
    if (!data) return null;
    const closesBy = new Map(data.map((d) => [d.symbol, d.closes]));
    const btc = closesBy.get(BENCH) ?? [];

    const qtyBy = new Map<string, number>();
    for (const p of positions) qtyBy.set(p.symbol, (qtyBy.get(p.symbol) ?? 0) + p.quantity);

    const inputs: PBetaInput[] = [];
    for (const [symbol, qty] of qtyBy) {
      const price = priceBy.get(symbol);
      const signedNotional = price != null && price > 0 ? qty * price : NaN;
      const beta = symbol === BENCH ? 1 : betaFor(closesBy.get(symbol) ?? [], btc);
      inputs.push({ symbol, signedNotional, beta });
    }
    return portfolioBeta(inputs);
  }, [data, positions, priceBy]);

  if (positions.length === 0) {
    return (
      <EmptyState>
        No open positions. Add paper trades in the <span className="text-term-amber">PORT</span> panel to see BTC beta.
      </EmptyState>
    );
  }
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (btcMissing) return <EmptyState>No BTC history to benchmark against.</EmptyState>;
  if (!result) return <Loading label="Loading history" />;

  const movePnl = result.btcEquivalent * 0.01;
  const eqColor = result.btcEquivalent >= 0 ? 'text-term-up' : 'text-term-down';
  const maxAbs = Math.max(1, ...result.rows.map((r) => Math.abs(r.betaWeighted)));

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2 text-2xs">
        <span className="text-term-dim">portfolio β vs BTC · {tf.label} daily</span>
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Headline: BTC-equivalent delta */}
      <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
        <div className="text-2xs uppercase tracking-wide text-term-dim">BTC-equivalent exposure</div>
        <div className={`font-mono text-xl ${eqColor}`}>{signedUsd(result.btcEquivalent)}</div>
        <div className="text-2xs text-term-muted">
          a 1% BTC move ≈ <span className={eqColor}>{signedUsd(movePnl)}</span>
          {Number.isFinite(result.betaToNet) && <> · effective β {result.betaToNet.toFixed(2)} per net $</>}
        </div>
      </div>

      {/* Net / gross */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
          <span className="text-2xs uppercase tracking-wide text-term-dim">Net notional</span>
          <span className={`font-mono text-sm ${result.netExposure >= 0 ? 'text-term-up' : 'text-term-down'}`}>
            {signedUsd(result.netExposure)}
          </span>
        </div>
        <div className="flex flex-col rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
          <span className="text-2xs uppercase tracking-wide text-term-dim">Gross notional</span>
          <span className="font-mono text-sm text-term-text">${fmtCompact(result.grossExposure)}</span>
        </div>
      </div>

      {/* Per-position contributions */}
      <div className="rounded-sm border border-term-border">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
          <span>Asset</span>
          <span className="text-right">β</span>
          <span className="text-right">BTC-eq</span>
        </div>
        {result.rows.map((r) => (
          <button
            key={r.symbol}
            onClick={() => navigate(panel, r.symbol)}
            className="no-drag relative grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-term-border/20 px-2 py-1 text-left text-2xs tabular-nums last:border-0 hover:bg-term-header/40"
          >
            <span
              className="absolute inset-y-0 left-0"
              style={{
                width: `${(Math.abs(r.betaWeighted) / maxAbs) * 100}%`,
                background: r.betaWeighted >= 0 ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
              }}
            />
            <span className="relative">
              <span className="text-term-text hover:text-term-amber">{base(r.symbol)}</span>
              <span className={`ml-1 uppercase ${r.signedNotional >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                {r.signedNotional >= 0 ? 'L' : 'S'}
              </span>
            </span>
            <span className="relative text-right text-term-muted">{r.beta.toFixed(2)}</span>
            <span className={`relative text-right ${r.betaWeighted >= 0 ? 'text-term-up' : 'text-term-down'}`}>
              {signedUsd(r.betaWeighted)}
            </span>
          </button>
        ))}
      </div>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        BTC-equivalent = Σ (signed notional × β vs BTC) — the spot-BTC position with the same first-order risk. It can
        flip sign versus net notional when the book leans on low- or negative-β names.
        {result.betaMissing > 0 && ` ${result.betaMissing} position(s) lack a usable β and are excluded.`}
      </p>
    </div>
  );
}
