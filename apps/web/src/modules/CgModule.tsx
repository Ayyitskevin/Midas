import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { cgBoard, type CgSort, type CgCross } from '@/lib/cg';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; length: number }[] = [
  { label: '10', length: 10 },
  { label: '20', length: 20 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: CgSort;
  label: string;
  align: 'left' | 'right';
  sort: CgSort;
  onSort: (c: CgSort) => void;
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

function CrossCell({ cross }: { cross: CgCross }) {
  if (cross === 'bull') return <span className="text-term-up">↑</span>;
  if (cross === 'bear') return <span className="text-term-down">↓</span>;
  return <span className="text-term-dim">·</span>;
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export function CgModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default length 10
  const [sort, setSort] = useState<CgSort>('cg');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, bars: h.candles.map((c) => ({ high: c.high, low: c.low })) }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? cgBoard(data, sort, per.length) : []), [data, sort, per.length]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Center of Gravity.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Ehlers Center of Gravity · length {per.label}</span>
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
          <EmptyState>Not enough history for the Center of Gravity.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="cg" label="CG" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">TRIG</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">CRS</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.cg)}`}>{signed(r.cg)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{signed(r.trigger)}</td>
                  <td className="px-2 py-0.5 text-center">
                    <CrossCell cross={r.cross} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Center of gravity of the last {per.label} median prices (bounded ±{((per.length - 1) / 2).toFixed(1)}) ·
        TRIG = prior CG · CRS <span className="text-term-up">↑</span>/<span className="text-term-down">↓</span> = CG
        crossed its trigger
      </div>
    </div>
  );
}
