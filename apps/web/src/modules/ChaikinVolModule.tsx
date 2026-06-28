import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { chaikinVolBoard, type ChaikinVolSort, type ChaikinRegime, type ChaikinBar } from '@/lib/chaikinVol';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; emaPeriod: number; rocPeriod: number }[] = [
  { label: '10', emaPeriod: 10, rocPeriod: 10 },
  { label: '21', emaPeriod: 21, rocPeriod: 21 },
];

const cvolClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function RegimeCell({ regime }: { regime: ChaikinRegime }) {
  if (regime === 'expanding') return <span className="text-term-amber">EXPANDING</span>;
  if (regime === 'contracting') return <span className="text-term-down">CONTRACTING</span>;
  return <span className="text-term-dim">FLAT</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: ChaikinVolSort;
  label: string;
  align: 'left' | 'right';
  sort: ChaikinVolSort;
  onSort: (c: ChaikinVolSort) => void;
}) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function ChaikinVolModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 10 / 10
  const [sort, setSort] = useState<ChaikinVolSort>('cvol');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low })) as ChaikinBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as ChaikinBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? chaikinVolBoard(data, sort, per.emaPeriod, per.rocPeriod) : []),
    [data, sort, per.emaPeriod, per.rocPeriod],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen Chaikin Volatility.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Chaikin Volatility · EMA {per.label} / ROC {per.label}</span>
        <div className="ml-auto flex gap-1">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPerIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === perIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history for Chaikin Volatility.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="cvol" label="CVOL%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">REGIME</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-left">
                    <button
                      onClick={() => navigate(panel, r.symbol)}
                      className="no-drag text-term-text hover:text-term-amber"
                    >
                      {base(r.symbol)}
                    </button>
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${cvolClass(r.chaikinVol)}`}>
                    {r.chaikinVol > 0 ? '+' : ''}
                    {r.chaikinVol.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <RegimeCell regime={r.regime} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Chaikin Volatility · %-change of the EMA-smoothed high−low range ·{' '}
        <span className="text-term-amber">+ expanding</span> (breakouts) /{' '}
        <span className="text-term-down">− contracting</span> (consolidation) · sorts fastest-expanding first
      </div>
    </div>
  );
}
