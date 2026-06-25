import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePortfolio } from '@/store/usePortfolio';
import { changeClass, fmtPrice, fmtCompact } from '@/lib/format';
import { positionRisk, aggregateRisk } from '@/lib/portfolioRisk';
import { navigate } from '@/commands/execute';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

const money = (v: number): string => `${v >= 0 ? '+' : '−'}$${fmtCompact(Math.abs(v))}`;

/** Heat tint scaled by |uPnL %| (saturating at ±10%). */
function heatStyle(pct: number | null): CSSProperties | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  const mag = Math.min(Math.abs(pct), 10) / 10;
  if (mag < 0.05) return undefined;
  const rgb = pct >= 0 ? '38,194,129' : '239,77,86';
  return { backgroundColor: `rgba(${rgb},${(mag * 0.3).toFixed(3)})` };
}

function liqClass(dist: number | null): string {
  if (dist == null) return 'text-term-dim';
  if (dist < 10) return 'text-term-down';
  if (dist < 25) return 'text-term-amber';
  return 'text-term-muted';
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function PortfolioRiskModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const [leverage, setLeverage] = useState('');

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions]);
  const { data } = useFetch((signal) => api.quotes(symbols, signal), [symbols.join(',')], {
    intervalMs: 5000,
    enabled: symbols.length > 0,
  });

  const priceBy = useMemo(() => new Map((data ?? []).map((q) => [q.symbol, q.price])), [data]);

  const levNum = num(leverage);
  const levVal = Number.isFinite(levNum) && levNum > 1 ? levNum : null;

  const { rows, agg } = useMemo(() => {
    const computed = positions.map((p) =>
      positionRisk({ symbol: p.symbol, quantity: p.quantity, entryPrice: p.entryPrice }, priceBy.get(p.symbol) ?? null, levVal),
    );
    const sorted = [...computed].sort((a, b) => (b.notional ?? 0) - (a.notional ?? 0));
    return { rows: sorted, agg: aggregateRisk(computed) };
  }, [positions, priceBy, levVal]);

  if (positions.length === 0) {
    return (
      <div className="p-3 text-xs text-term-muted">
        No open positions. Add paper trades in the <span className="text-term-amber">PORT</span> panel to see risk and
        exposure.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-3 gap-1.5 border-b border-term-border p-2">
        <Stat label="Unrealized" value={money(agg.totalUPnl)} accent={changeClass(agg.totalUPnl)} />
        <Stat label="Gross exp." value={`$${fmtCompact(agg.grossNotional)}`} />
        <Stat label="Net exp." value={money(agg.netNotional)} accent={changeClass(agg.netNotional)} />
        <Stat label="Long" value={`$${fmtCompact(agg.longNotional)}`} accent="text-term-up" />
        <Stat label="Short" value={`$${fmtCompact(agg.shortNotional)}`} accent="text-term-down" />
        <Stat label="Concentration" value={agg.maxWeightPct == null ? '—' : `${agg.maxWeightPct.toFixed(0)}%`} />
      </div>

      <div className="no-drag flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-2xs uppercase tracking-wide text-term-dim">Assumed leverage</span>
        <input
          type="number"
          inputMode="decimal"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
          placeholder="spot"
          className="w-16 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-0.5 font-mono text-2xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
        />
        <span className="text-2xs text-term-dim">{levVal ? `liq. distance @ ${levVal}×` : 'set >1 for liq. estimate'}</span>
      </div>

      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <th className="px-2 py-1 text-left font-normal">POSITION</th>
              <th className="px-2 py-1 text-right font-normal">uP&L%</th>
              <th className="px-2 py-1 text-right font-normal">uP&L</th>
              <th className="px-2 py-1 text-right font-normal">NOTIONAL</th>
              <th className="px-2 py-1 text-right font-normal">WT</th>
              {levVal && <th className="px-2 py-1 text-right font-normal">LIQ Δ</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wt = agg.grossNotional > 0 && r.notional != null ? (r.notional / agg.grossNotional) * 100 : null;
              return (
                <tr key={r.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                    <div className={`text-2xs ${r.side === 'long' ? 'text-term-up' : 'text-term-down'}`}>
                      {r.side} {fmtPrice(r.qty, 4)}
                    </div>
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${changeClass(r.uPnlPct)}`}
                    style={heatStyle(r.uPnlPct)}
                  >
                    {r.uPnlPct == null ? '—' : `${r.uPnlPct >= 0 ? '+' : ''}${r.uPnlPct.toFixed(2)}%`}
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.uPnl)}`}>
                    {r.uPnl == null ? '—' : money(r.uPnl)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.notional == null ? '—' : `$${fmtCompact(r.notional)}`}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    {wt == null ? '—' : `${wt.toFixed(0)}%`}
                  </td>
                  {levVal && (
                    <td className={`px-2 py-1 text-right tabular-nums ${liqClass(r.liqDistancePct)}`}>
                      {r.liqDistancePct == null ? '—' : `${r.liqDistancePct.toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-term-border px-2 py-1 text-2xs leading-relaxed text-term-dim">
        Marks each paper position to live prices. Liquidation is a rough isolated-margin estimate at the assumed
        leverage; spot positions don't liquidate.
      </p>
    </div>
  );
}
