import { useMemo, useState } from 'react';
import type { Candle, Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { keltnerBoard, type KeltSort } from '@/lib/keltner';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; period: number; mult: number }[] = [
  { label: '20·2', period: 20, mult: 2 },
  { label: '10·1.5', period: 10, mult: 1.5 },
];

// Amber when price has pushed outside the channel.
const posColor = (v: number) => (v > 100 || v < 0 ? 'text-term-amber' : 'text-term-text');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: KeltSort;
  label: string;
  align: 'left' | 'right';
  sort: KeltSort;
  onSort: (c: KeltSort) => void;
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

export function KeltnerModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 20·2
  const [sort, setSort] = useState<KeltSort>('pos');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, candles: h.candles }))
            .catch(() => ({ symbol: s, candles: [] as Candle[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? keltnerBoard(data, sort, preset.period, preset.mult) : []),
    [data, sort, preset.period, preset.mult],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to track Keltner channels.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Keltner channel · EMA ± ATR · {preset.label}</span>
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
          <EmptyState>Not enough history for Keltner channels.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="pos" label="POS" align="right" sort={sort} onSort={setSort} />
                <SortHead col="width" label="WIDTH%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">BRK</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${posColor(r.pos)}`}>{r.pos.toFixed(0)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.width.toFixed(1)}%</td>
                  <td className="px-2 py-0.5 text-right">
                    {r.breakout === 'up' ? (
                      <span className="text-term-up">↑</span>
                    ) : r.breakout === 'down' ? (
                      <span className="text-term-down">↓</span>
                    ) : (
                      <span className="text-term-dim">·</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        POS = close in channel (0 lower · 50 mid · 100 upper) · WIDTH% = band width ÷ price · BRK ={' '}
        <span className="text-term-up">↑</span> / <span className="text-term-down">↓</span> close outside the channel
      </div>
    </div>
  );
}
