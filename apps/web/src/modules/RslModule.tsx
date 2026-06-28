import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { rslBoard, type RslSort, type RslSide } from '@/lib/rsl';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Lookback presets: Levy's classic 130 (~27 weeks) vs a faster 50.
const PRESETS: { label: string; period: number }[] = [
  { label: '130', period: 130 },
  { label: '50', period: 50 },
];

const SIDE_LABEL: Record<RslSide, string> = { up: '▲ strong', down: '▼ weak' };
const sideClass = (s: RslSide) => (s === 'up' ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: RslSort;
  label: string;
  align: 'left' | 'right';
  sort: RslSort;
  onSort: (c: RslSort) => void;
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

export function RslModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 130 (Levy)
  const [sort, setSort] = useState<RslSort>('rsl');
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
    () => (data ? rslBoard(data, sort, preset.period) : []),
    [data, sort, preset.period],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen relative strength.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">RSL · close ÷ SMA · N{preset.period}</span>
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
          <EmptyState>Not enough history to compute RSL.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="rsl" label="RSL" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">DEV%</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">SIDE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${sideClass(r.side)}`}>
                    {r.rsl.toFixed(3)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${sideClass(r.side)}`}>
                    {fmtSignedPercent(r.devPct, 1)}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${sideClass(r.side)}`}>{SIDE_LABEL[r.side]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        RSL = close ÷ SMA(N) · <span className="text-term-up">&gt; 1</span> above its average (strong) /{' '}
        <span className="text-term-down">&lt; 1</span> below (weak) · scale-invariant across symbols
      </div>
    </div>
  );
}
