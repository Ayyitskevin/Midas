import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePortfolio } from '@/store/usePortfolio';
import { rebalance, type RebalHolding } from '@/lib/rebalance';
import { fmtPrice, fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const base = (sym: string) => sym.replace(/\/.*$/, '');
const signedUsd = (v: number) => `${v < 0 ? '−' : '+'}$${fmtCompact(Math.abs(v))}`;

export function RebalanceModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);
  const { data: quotes } = useFetch((signal) => api.quotes(symbols, signal), [symbols.join(',')], {
    intervalMs: 10_000,
    enabled: symbols.length > 0,
  });

  const priceBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes ?? []) m.set(q.symbol, q.price);
    return m;
  }, [quotes]);

  const { plan, priced } = useMemo(() => {
    const qtyBy = new Map<string, number>();
    for (const p of positions) qtyBy.set(p.symbol, (qtyBy.get(p.symbol) ?? 0) + p.quantity);
    const valueBy = new Map<string, number>();
    for (const [sym, qty] of qtyBy) {
      const price = priceBy.get(sym);
      if (price != null && price > 0) valueBy.set(sym, qty * price);
    }
    let total = 0;
    for (const v of valueBy.values()) total += v;
    const holdings: RebalHolding[] = [];
    for (const [sym, value] of valueBy) {
      const curPct = total > 0 ? (value / total) * 100 : 0;
      const t = targets[sym];
      const targetPct = t != null && t.trim() !== '' ? Number(t) : curPct;
      holdings.push({ symbol: sym, value, targetPct });
    }
    return { plan: rebalance(holdings), priced: valueBy.size };
  }, [positions, priceBy, targets]);

  const equalWeight = () => {
    const n = plan.rows.length;
    if (n === 0) return;
    const w = (100 / n).toFixed(1);
    setTargets(Object.fromEntries(plan.rows.map((r) => [r.symbol, w])));
  };

  if (positions.length === 0) {
    return (
      <EmptyState>
        No open positions. Add paper trades in the <span className="text-term-amber">PORT</span> panel to plan a rebalance.
      </EmptyState>
    );
  }

  const targetOff = Math.abs(plan.targetSum - 100) > 0.5 && priced > 0;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">rebalance · ${fmtCompact(plan.total)} · {priced} priced</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={equalWeight}
            className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted hover:text-term-amber"
          >
            Equal wt
          </button>
          <button
            onClick={() => setTargets({})}
            className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted hover:text-term-amber"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {priced === 0 ? (
          <EmptyState>Waiting for marks to price the book…</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">CUR%</th>
                <th className="px-2 py-1 text-right font-normal">TGT%</th>
                <th className="px-2 py-1 text-right font-normal">DRIFT</th>
                <th className="px-2 py-1 text-right font-normal">TRADE</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => {
                const price = priceBy.get(r.symbol) ?? 0;
                const qty = price > 0 ? r.tradeValue / price : 0;
                const buy = r.tradeValue > 0;
                const flat = Math.abs(r.tradeValue) < 0.005 * (plan.total || 1);
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
                    <td className="px-2 py-0.5 text-right text-term-muted">{r.currentPct.toFixed(1)}%</td>
                    <td className="px-1 py-0.5 text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={targets[r.symbol] ?? r.currentPct.toFixed(1)}
                        onChange={(e) => setTargets((t) => ({ ...t, [r.symbol]: e.target.value }))}
                        className="no-drag w-12 rounded-sm border border-term-border bg-term-bg/40 px-1 py-0.5 text-right font-mono text-term-text outline-none focus:border-term-amber/60"
                      />
                    </td>
                    <td
                      className={`px-2 py-0.5 text-right ${
                        Math.abs(r.driftPct) < 0.1 ? 'text-term-muted' : r.driftPct > 0 ? 'text-term-down' : 'text-term-up'
                      }`}
                    >
                      {r.driftPct >= 0 ? '+' : ''}
                      {r.driftPct.toFixed(1)}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${flat ? 'text-term-muted' : buy ? 'text-term-up' : 'text-term-down'}`}>
                      {flat ? '—' : (
                        <>
                          {signedUsd(r.tradeValue)}
                          <span className="ml-1 text-2xs text-term-dim">
                            {buy ? 'buy' : 'sell'} {fmtPrice(Math.abs(qty), 4)}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-term-border px-2 py-1 text-2xs">
        <span className={targetOff ? 'text-term-down' : 'text-term-muted'}>
          targets {plan.targetSum.toFixed(0)}%
        </span>
        <span className="text-term-up">buy ${fmtCompact(plan.totalBuy)}</span>
        <span className="text-term-down">sell ${fmtCompact(plan.totalSell)}</span>
        <span className="ml-auto text-term-dim">turnover {plan.turnover.toFixed(1)}%</span>
      </div>
    </div>
  );
}
