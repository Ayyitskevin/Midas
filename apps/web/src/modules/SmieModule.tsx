import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { smieBoard, type SmieSort, type SmieCross } from '@/lib/smie';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; long: number }[] = [
  { label: '20', long: 20 },
  { label: '12', long: 12 },
];

const CROSS_LABEL: Record<SmieCross, string> = { bull: '▲ bull', bear: '▼ bear', none: '·' };

function crossClass(c: SmieCross) {
  return c === 'bull' ? 'text-term-up' : c === 'bear' ? 'text-term-down' : 'text-term-dim';
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SmieSort;
  label: string;
  align: 'left' | 'right' | 'center';
  sort: SmieSort;
  onSort: (c: SmieSort) => void;
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

export function SmieModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 20
  const [sort, setSort] = useState<SmieSort>('smi');
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
    () => (data ? smieBoard(data, sort, per.long, 5, 5) : []),
    [data, sort, per.long],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the SMI Ergodic.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">SMI Ergodic · TSI({per.label}/5) · signal 5</span>
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
          <EmptyState>Not enough history to compute the SMI Ergodic.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="smi" label="SMI" align="right" sort={sort} onSort={setSort} />
                <SortHead col="hist" label="HIST" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">CROSS</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.smi)}`}>
                    {r.smi > 0 ? '+' : ''}
                    {r.smi.toFixed(2)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.hist)}`}>
                    {r.hist > 0 ? '+' : ''}
                    {r.hist.toFixed(2)}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${crossClass(r.cross)}`}>{CROSS_LABEL[r.cross]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        SMI Ergodic = double-smoothed momentum (TSI) · <span className="text-term-up">&gt; 0</span> bullish /{' '}
        <span className="text-term-down">&lt; 0</span> bearish · CROSS = signal-line flip
      </div>
    </div>
  );
}
