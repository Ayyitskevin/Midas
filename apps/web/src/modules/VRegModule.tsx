import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { volRegimeBoard, type VRegSort } from '@/lib/volRegime';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const ANN = Math.sqrt(365);
const base = (sym: string) => sym.replace(/\/.*$/, '');
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

// Expanding vol (ratio > 1) reads as risk waking up → warn; contracting calms.
const ratioColor = (v: number | null) =>
  v == null ? 'text-term-muted' : v >= 1 ? 'text-term-down' : 'text-term-up';

function Win({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-term-dim">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="no-drag w-9 rounded-sm border border-term-border bg-term-bg/40 px-1 py-0.5 text-right font-mono text-2xs text-term-text outline-none focus:border-term-amber/60"
      />
    </label>
  );
}

function SortHead({
  col,
  label,
  sort,
  onSort,
}: {
  col: VRegSort;
  label: string;
  sort: VRegSort;
  onSort: (c: VRegSort) => void;
}) {
  return (
    <th className="px-2 py-1 text-right font-normal">
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

export function VRegModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<VRegSort>('ratio');
  const [shortW, setShortW] = useState('20');
  const [longW, setLongW] = useState('60');
  const tf = TIMEFRAMES[tfIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, tf.interval, tf.range, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(','), tf.interval, tf.range],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? volRegimeBoard(data, num(shortW), num(longW), sort) : []),
    [data, shortW, longW, sort],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to track expanding vs contracting volatility.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">vol regime · {tf.label} daily</span>
        <Win label="s" value={shortW} onChange={setShortW} />
        <Win label="l" value={longW} onChange={setLongW} />
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
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
          <EmptyState>Need a long window of history and short &lt; long windows.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <th className="px-2 py-1 text-left font-normal">
                  <button
                    onClick={() => setSort('symbol')}
                    className={`no-drag hover:text-term-amber ${sort === 'symbol' ? 'text-term-amber' : 'text-term-muted'}`}
                  >
                    SYMBOL
                  </button>
                </th>
                <SortHead col="ratio" label="S/L" sort={sort} onSort={setSort} />
                <SortHead col="shortVol" label="SHORT" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">LONG</th>
                <SortHead col="pct" label="PCT" sort={sort} onSort={setSort} />
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${ratioColor(r.ratio)}`}>
                    {r.ratio == null ? '—' : `${r.ratio.toFixed(2)}×`}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-text">{(r.shortVol * ANN * 100).toFixed(0)}%</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{(r.longVol * ANN * 100).toFixed(0)}%</td>
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0 bg-term-amber/12"
                      style={{ width: `${r.pct == null ? 0 : r.pct}%` }}
                    />
                    <span className="relative text-term-amber">{r.pct == null ? '—' : `${r.pct.toFixed(0)}%`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        S/L = short ÷ long realized vol · <span className="text-term-down">&gt;1</span> expanding, <span className="text-term-up">&lt;1</span> calming · PCT = where today's vol sits in its rolling history · annualized
      </div>
    </div>
  );
}
