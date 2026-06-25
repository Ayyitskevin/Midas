import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePortfolio } from '@/store/usePortfolio';
import { riskBudget, type RiskBudgetInput } from '@/lib/riskBudget';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '30D', interval: '1d', range: '1mo' },
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

export function RiskBudgetModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const [tfIdx, setTfIdx] = useState(2); // default 1Y
  const tf = TIMEFRAMES[tfIdx];

  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        symbols.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [symbols.join(','), tf.interval, tf.range],
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

  const result = useMemo(() => {
    if (!data) return null;
    const closesBy = new Map(data.map((d) => [d.symbol, d.closes]));

    // Net quantity per symbol → notional value → weight share of gross value.
    const qtyBy = new Map<string, number>();
    for (const p of positions) qtyBy.set(p.symbol, (qtyBy.get(p.symbol) ?? 0) + p.quantity);

    const raw: { symbol: string; value: number; closes: number[] }[] = [];
    let gross = 0;
    for (const [symbol, qty] of qtyBy) {
      const price = priceBy.get(symbol);
      if (price == null || !(price > 0)) continue;
      const value = qty * price;
      gross += Math.abs(value);
      raw.push({ symbol, value, closes: closesBy.get(symbol) ?? [] });
    }
    if (gross <= 0) return null;

    const inputs: RiskBudgetInput[] = raw.map((r) => ({
      symbol: r.symbol,
      weight: r.value / gross,
      closes: r.closes,
    }));
    return riskBudget(inputs);
  }, [data, positions, priceBy]);

  if (positions.length === 0) {
    return (
      <EmptyState>
        No open positions. Add paper trades in the <span className="text-term-amber">PORT</span> panel to budget risk.
      </EmptyState>
    );
  }
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!result) return <Loading label="Loading prices" />;
  if (!result.ok || result.rows.length === 0) {
    return <EmptyState>Not enough history (or no priced, risk-bearing holdings) to budget risk.</EmptyState>;
  }

  const maxPct = Math.max(1, ...result.rows.map((r) => Math.abs(r.pctRisk)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">risk budget · MCTR · {result.n} holdings</span>
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

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        <table className="w-full text-2xs tabular-nums">
          <thead className="sticky top-0 bg-term-panel">
            <tr>
              <th className="px-2 py-1 text-left font-normal text-term-muted">SYMBOL</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">VOL</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">WEIGHT</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">RISK%</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">vs WT</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              // A holding that punches above its weight on risk is the warning.
              const concentration = r.pctRisk - r.pctWeight;
              return (
                <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-left">
                    <button
                      onClick={() => navigate(panel, r.symbol)}
                      className="no-drag text-term-text hover:text-term-amber"
                    >
                      {base(r.symbol)}
                    </button>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.vol * ANN * 100).toFixed(0)}%</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.pctWeight.toFixed(1)}%</td>
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0 bg-term-amber/15"
                      style={{ width: `${(Math.abs(r.pctRisk) / maxPct) * 100}%` }}
                    />
                    <span className="relative font-semibold text-term-amber">{r.pctRisk.toFixed(1)}%</span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${concentration > 0 ? 'text-term-down' : 'text-term-up'}`}>
                    {concentration > 0 ? '+' : ''}
                    {concentration.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <div>
          portfolio vol <span className="font-semibold text-term-text">{(result.portVol * ANN * 100).toFixed(1)}%</span> annualized · RISK% = each name's Euler share of σₚ (sums to 100)
        </div>
        <div className="mt-0.5">vs WT = risk% − weight% · <span className="text-term-down">+</span> means the name drives more risk than its size</div>
      </div>
    </div>
  );
}
