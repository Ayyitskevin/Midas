import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { ttmBoard, type TtmSort, type TtmRow } from '@/lib/ttm';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; period: number; bbMult: number; kcMult: number }[] = [
  { label: '20·2·1.5', period: 20, bbMult: 2, kcMult: 1.5 }, // standard
  { label: '20·2·1', period: 20, bbMult: 2, kcMult: 1 }, // high-compression (wide squeeze)
];

const momColor = (dir: TtmRow['momDir']) => (dir === 'up' ? 'text-term-up' : 'text-term-down');

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: TtmSort;
  label: string;
  align: 'left' | 'right';
  sort: TtmSort;
  onSort: (c: TtmSort) => void;
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

function SqueezeCell({ row }: { row: TtmRow }) {
  if (row.squeeze === 'on') return <span className="text-term-amber">● ON</span>;
  if (row.fired)
    return (
      <span className={momColor(row.momDir)}>
        {row.momDir === 'up' ? '↑' : '↓'} FIRE
      </span>
    );
  return <span className="text-term-dim">·</span>;
}

export function TtmModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 20·2·1.5
  const [sort, setSort] = useState<TtmSort>('squeeze');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number; close: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? ttmBoard(data, sort, preset.period, preset.bbMult, preset.kcMult) : []),
    [data, sort, preset.period, preset.bbMult, preset.kcMult],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to scan for TTM squeezes.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">TTM squeeze · BB in KC · {preset.label}</span>
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
          <EmptyState>Not enough history to scan for squeezes.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="squeeze" label="SQZ" align="left" sort={sort} onSort={setSort} />
                <SortHead col="mom" label="MOM%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">MOM</th>
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
                  <td className="px-2 py-0.5 text-left">
                    <SqueezeCell row={r} />
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${momColor(r.momDir)}`}>
                    {r.momPct > 0 ? '+' : ''}
                    {r.momPct.toFixed(1)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${momColor(r.momDir)}`}>{r.momRising ? '▲' : '▽'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-amber">● ON</span> = BB inside KC (coiling) · FIRE = squeeze just released · MOM% = Carter
        momentum ÷ price · ▲ rising / ▽ falling
      </div>
    </div>
  );
}
