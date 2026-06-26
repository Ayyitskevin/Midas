import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { trixBoard, type TrixSort, type TrixSide, type TrixCross } from '@/lib/trix';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; period: number; signal: number }[] = [
  { label: '15·9', period: 15, signal: 9 }, // standard
  { label: '9·5', period: 9, signal: 5 }, // faster
];

const sideColor = (side: TrixSide) => (side === 'up' ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TrixSort;
  label: string;
  align: 'left' | 'right';
  sort: TrixSort;
  onSort: (c: TrixSort) => void;
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

function CrossCell({ cross }: { cross: TrixCross }) {
  if (cross === 'bull') return <span className="text-term-up">↑</span>;
  if (cross === 'bear') return <span className="text-term-down">↓</span>;
  return <span className="text-term-dim">·</span>;
}

export function TrixModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 15·9
  const [sort, setSort] = useState<TrixSort>('trix');
  const preset = PRESETS[presetIdx];

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
    () => (data ? trixBoard(data, sort, preset.period, preset.signal) : []),
    [data, sort, preset.period, preset.signal],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen TRIX.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">TRIX · triple-EMA · {preset.label}</span>
        <div className="ml-auto flex gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPresetIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === presetIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history to compute TRIX.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="trix" label="TRIX" align="right" sort={sort} onSort={setSort} />
                <SortHead col="hist" label="HIST" align="right" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${sideColor(r.side)}`}>
                    {r.trix > 0 ? '+' : ''}
                    {r.trix.toFixed(3)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.hist)}`}>
                    {r.hist > 0 ? '+' : ''}
                    {r.hist.toFixed(3)}
                  </td>
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
        TRIX = % ROC of the triple EMA ({preset.label}) · <span className="text-term-up">&gt;0 up</span> /{' '}
        <span className="text-term-down">&lt;0 down</span> · HIST = TRIX − signal · CRS = TRIX×signal cross
      </div>
    </div>
  );
}
