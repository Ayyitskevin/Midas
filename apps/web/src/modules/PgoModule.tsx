import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { pgoBoard, type PgoSort, type PgoBar } from '@/lib/pgo';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PERIODS: { label: string; period: number }[] = [
  { label: '89', period: 89 },
  { label: '21', period: 21 },
];

const ZONE_LABEL: Record<string, string> = { hi: '+ stretch', lo: '− stretch', mid: '· mid' };

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: PgoSort;
  label: string;
  align: 'left' | 'right';
  sort: PgoSort;
  onSort: (c: PgoSort) => void;
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

function zoneClass(zone: string) {
  return zone === 'hi' ? 'text-term-up' : zone === 'lo' ? 'text-term-down' : 'text-term-dim';
}

export function PgoModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [perIdx, setPerIdx] = useState(0); // default 89
  const [sort, setSort] = useState<PgoSort>('pgo');
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
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })) as PgoBar[],
            }))
            .catch(() => ({ symbol: s, bars: [] as PgoBar[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(() => (data ? pgoBoard(data, sort, per.period) : []), [data, sort, per.period]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Pretty Good Oscillator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Pretty Good Osc · ATR-units from mean · period {per.label}</span>
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
          <EmptyState>Not enough history to compute the PGO.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pgo" label="PGO" align="right" sort={sort} onSort={setSort} />
                <SortHead col="abs" label="|PGO|" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.pgo)}`}>
                    {r.pgo > 0 ? '+' : ''}
                    {r.pgo.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{Math.abs(r.pgo).toFixed(2)}</td>
                  <td className={`px-2 py-0.5 text-center ${zoneClass(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        PGO = (close − {per.label}-SMA) ÷ ATR · <span className="text-term-up">≥ +3</span> /{' '}
        <span className="text-term-down">≤ −3</span> = stretched · 0 = at the mean
      </div>
    </div>
  );
}
