import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { kamaBoard, type KamaSort, type KamaDir } from '@/lib/kama';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; n: number }[] = [
  { label: '10', n: 10 },
  { label: '20', n: 20 },
];

const DIR_LABEL: Record<KamaDir, string> = { up: '▲ up', down: '▼ down', flat: '· flat' };

function dirClass(d: KamaDir) {
  return d === 'up' ? 'text-term-up' : d === 'down' ? 'text-term-down' : 'text-term-dim';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: KamaSort;
  label: string;
  align: 'left' | 'right' | 'center';
  sort: KamaSort;
  onSort: (c: KamaSort) => void;
}) {
  const justify = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-2 py-1 font-normal ${justify}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function KamaModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 10
  const [sort, setSort] = useState<KamaSort>('dist');
  const per = PERIODS[perIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? kamaBoard(data, sort, per.n) : []),
    [data, sort, per.n],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the KAMA trend.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">KAMA · adaptive MA · ER {per.label} · fast 2 / slow 30</span>
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
          <EmptyState>Not enough history to compute the KAMA.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="slope" label="DIR" align="center" sort={sort} onSort={setSort} />
                <SortHead col="er" label="ER%" align="right" sort={sort} onSort={setSort} />
                <SortHead col="dist" label="DIST%" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-center font-semibold ${dirClass(r.dir)}`}>
                    {DIR_LABEL[r.dir]}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.er * 100).toFixed(0)}</td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.distPct)}`}>
                    {r.distPct > 0 ? '+' : ''}
                    {r.distPct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        KAMA speeds up on a high Efficiency Ratio (clean trend), flattens in chop ·{' '}
        <span className="text-term-up">▲</span> rising / <span className="text-term-down">▼</span> falling · DIST% = close vs KAMA
      </div>
    </div>
  );
}
