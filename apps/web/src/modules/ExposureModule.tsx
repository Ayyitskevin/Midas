import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { usePortfolio } from '@/store/usePortfolio';
import { computeExposure, type ExposurePosition } from '@/lib/exposure';
import { fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
const base = (sym: string) => sym.replace(/\/.*$/, '');

function Stat({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="flex flex-col rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
      {sub && <span className="text-2xs text-term-dim">{sub}</span>}
    </div>
  );
}

export function ExposureModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const [account, setAccount] = useState('10000');

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions]);
  const { data: quotes } = useFetch((signal) => api.quotes(symbols, signal), [symbols.join(',')], {
    intervalMs: 10_000,
    enabled: symbols.length > 0,
  });

  const priceBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes ?? []) m.set(q.symbol, q.price);
    return m;
  }, [quotes]);

  const exp = useMemo(() => {
    const ep: ExposurePosition[] = positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      price: priceBy.get(p.symbol) ?? null,
    }));
    return computeExposure(ep, num(account));
  }, [positions, priceBy, account]);

  if (positions.length === 0) {
    return (
      <EmptyState>
        No open positions. Add paper trades in the <span className="text-term-amber">PORT</span> panel to see exposure.
      </EmptyState>
    );
  }

  const effAssets = exp.hhi > 0 ? 1 / exp.hhi : 0;
  const concLabel = exp.hhi >= 0.5 ? 'concentrated' : exp.hhi >= 0.25 ? 'moderate' : 'diversified';

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2 text-2xs">
        <span className="text-term-dim">portfolio exposure · {exp.weights.length} assets</span>
        <label className="ml-auto flex items-center gap-1">
          <span className="text-term-dim">acct $</span>
          <input
            type="number"
            inputMode="decimal"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="w-20 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-0.5 font-mono text-xs text-term-text outline-none focus:border-term-amber/60"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Gross"
          value={`$${fmtCompact(exp.gross)}`}
          sub={exp.grossLeverage != null ? `${exp.grossLeverage.toFixed(2)}× acct` : undefined}
        />
        <Stat
          label="Net"
          value={`${exp.net >= 0 ? '' : '−'}$${fmtCompact(Math.abs(exp.net))}`}
          accent={exp.net >= 0 ? 'text-term-up' : 'text-term-down'}
          sub={exp.netLeverage != null ? `${exp.netLeverage.toFixed(2)}× acct` : undefined}
        />
        <Stat label="Concentration" value={exp.hhi.toFixed(2)} sub={`~${effAssets.toFixed(1)} eff · ${concLabel}`} />
        <Stat label="Top weight" value={`${(exp.topWeight * 100).toFixed(0)}%`} sub={base(exp.weights[0]?.symbol ?? '')} />
      </div>

      {/* Long / short split */}
      <div>
        <div className="mb-0.5 flex justify-between text-2xs">
          <span className="text-term-up">long ${fmtCompact(exp.long)} ({exp.longPct.toFixed(0)}%)</span>
          <span className="text-term-down">short ${fmtCompact(exp.short)} ({exp.shortPct.toFixed(0)}%)</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-sm bg-term-bg">
          <div className="bg-term-up/70" style={{ width: `${exp.longPct}%` }} />
          <div className="bg-term-down/70" style={{ width: `${exp.shortPct}%` }} />
        </div>
      </div>

      {/* Per-asset weights */}
      <div className="rounded-sm border border-term-border">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-term-border px-2 py-1 text-2xs uppercase tracking-wide text-term-dim">
          <span>Asset (weight)</span>
          <span className="text-right">Notional</span>
          <span className="text-right">Wt</span>
        </div>
        {exp.weights.map((w) => (
          <button
            key={w.symbol}
            onClick={() => navigate(panel, w.symbol)}
            className="no-drag relative grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-term-border/20 px-2 py-1 text-left text-2xs tabular-nums last:border-0 hover:bg-term-header/40"
          >
            <span
              className="absolute inset-y-0 left-0"
              style={{
                width: `${w.weight * 100}%`,
                background: w.side === 'long' ? 'rgba(38,194,129,0.12)' : 'rgba(239,77,86,0.12)',
              }}
            />
            <span className="relative">
              <span className="text-term-text hover:text-term-amber">{base(w.symbol)}</span>
              <span className={`ml-1 uppercase ${w.side === 'long' ? 'text-term-up' : 'text-term-down'}`}>
                {w.side === 'long' ? 'L' : 'S'}
              </span>
            </span>
            <span className="relative text-right text-term-muted">${fmtCompact(w.grossNotional)}</span>
            <span className="relative text-right text-term-text">{(w.weight * 100).toFixed(1)}%</span>
          </button>
        ))}
      </div>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Gross = Σ|notional|, net = Σ signed notional (long − short). Leverage is vs the account equity above.
        Concentration is the Herfindahl index (Σ weight²); ~1/HHI is the effective number of equally-weighted assets.
      </p>
    </div>
  );
}
