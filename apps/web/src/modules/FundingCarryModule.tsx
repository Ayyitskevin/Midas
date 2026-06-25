import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { computeCarry, sortCarry, type CarrySortKey, type CarrySide } from '@/lib/carry';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const fmtRate = (r: number | null): string => (r == null ? '—' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`);
const fmtPctVal = (v: number | null, d = 1): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

function untilNext(ms: number | null): string {
  if (ms == null) return '—';
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

const SIDE_LABEL: Record<CarrySide, string> = { 'short-perp': 'short perp', 'long-perp': 'long perp', flat: '—' };

export function FundingCarryModule({ panel }: ModuleProps) {
  const [sortKey, setSortKey] = useState<CarrySortKey>('apr');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const { data: funding, error, loading, refresh } = useFetch(
    (signal) => api.funding('USDT', 30, signal),
    [],
    { intervalMs: 15_000 },
  );

  const symbols = useMemo(() => (funding ?? []).map((r) => r.symbol), [funding]);
  const { data: quotes } = useFetch((signal) => api.quotes(symbols, signal), [symbols.join(',')], {
    intervalMs: 15_000,
    enabled: symbols.length > 0,
  });
  const spotBy = useMemo(() => new Map((quotes ?? []).map((q) => [q.symbol, q.price])), [quotes]);

  const rows = useMemo(() => {
    const carry = (funding ?? []).map((r) =>
      computeCarry(
        {
          symbol: r.symbol,
          fundingRate: r.fundingRate,
          markPrice: r.markPrice,
          openInterestValue: r.openInterestValue,
          nextFundingTime: r.nextFundingTime,
        },
        spotBy.get(r.symbol) ?? null,
      ),
    );
    return sortCarry(carry, sortKey, dir);
  }, [funding, spotBy, sortKey, dir]);

  const sortBy = (key: CarrySortKey) => {
    if (key === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };
  const arrow = (key: CarrySortKey) => (key === sortKey ? (dir === 'desc' ? ' ▾' : ' ▴') : '');
  const th = (key: CarrySortKey | null, label: string, align: string) => (
    <th className={`px-2 py-1 font-normal ${align}`}>
      {key ? (
        <button className="no-drag hover:text-term-text" onClick={() => sortBy(key)}>
          {label}
          {arrow(key)}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">FUNDING CARRY</span>
        <span className="text-term-dim">perps · USDT · APR &amp; basis</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !funding && <Loading label="Loading funding" />}
        {error && !funding && <ErrorMsg message={error} onRetry={refresh} />}
        {funding && funding.length === 0 && <EmptyState>No perp funding available.</EmptyState>}
        {funding && funding.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                {th('symbol', 'SYMBOL', 'text-left')}
                {th(null, 'FUND', 'text-right')}
                {th('apr', 'APR', 'text-right')}
                {th('basis', 'BASIS', 'text-right')}
                {th(null, 'CARRY', 'text-left')}
                {th('oi', 'OI', 'text-right')}
                {th(null, 'NEXT', 'text-right')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.fundingRate)}`}>
                    {fmtRate(r.fundingRate)}
                  </td>
                  <td className={`px-2 py-1 text-right font-medium tabular-nums ${changeClass(r.aprPct)}`}>
                    {fmtPctVal(r.aprPct)}
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.basisPct)}`}>
                    {fmtPctVal(r.basisPct, 2)}
                  </td>
                  <td className="px-2 py-1 text-left text-2xs text-term-muted">{SIDE_LABEL[r.side]}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">${fmtCompact(r.oi)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-dim">{untilNext(r.nextFundingTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-term-border px-2 py-1 text-2xs leading-relaxed text-term-dim">
        APR = funding annualized. Basis = perp vs spot. Carry names the leg that collects funding (delta-neutral); gross
        of fees.
      </p>
    </div>
  );
}
