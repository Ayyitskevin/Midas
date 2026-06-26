import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { ichimokuBoard, type IchiSort, type IchiCloud, type IchiColor, type IchiCross } from '@/lib/ichimoku';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '2y'; // Ichimoku needs kijun + senkouB bars (78 for 9/26/52)

const PRESETS: { label: string; tenkan: number; kijun: number; senkouB: number }[] = [
  { label: '9·26·52', tenkan: 9, kijun: 26, senkouB: 52 }, // standard
  { label: '20·60·120', tenkan: 20, kijun: 60, senkouB: 120 }, // slower / higher-conviction
];

const CLOUD_LABEL: Record<IchiCloud, string> = { above: 'ABOVE', below: 'BELOW', inside: 'IN' };
const cloudColorClass = (c: IchiCloud) =>
  c === 'above' ? 'text-term-up' : c === 'below' ? 'text-term-down' : 'text-term-muted';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: IchiSort;
  label: string;
  align: 'left' | 'right';
  sort: IchiSort;
  onSort: (c: IchiSort) => void;
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

function CrossCell({ cross }: { cross: IchiCross }) {
  if (cross === 'bull') return <span className="text-term-up">↑</span>;
  if (cross === 'bear') return <span className="text-term-down">↓</span>;
  return <span className="text-term-dim">·</span>;
}

function ColorCell({ color }: { color: IchiColor }) {
  if (color === 'bull') return <span className="text-term-up">▲</span>;
  if (color === 'bear') return <span className="text-term-down">▼</span>;
  return <span className="text-term-dim">·</span>;
}

export function IchimokuModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 9·26·52
  const [sort, setSort] = useState<IchiSort>('cloud');
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
    () => (data ? ichimokuBoard(data, sort, preset.tenkan, preset.kijun, preset.senkouB) : []),
    [data, sort, preset.tenkan, preset.kijun, preset.senkouB],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen Ichimoku clouds.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Ichimoku cloud · {preset.label}</span>
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
          <EmptyState>Not enough history for the Ichimoku cloud.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="cloud" label="CLOUD" align="left" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">TK</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">CLR</th>
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
                  <td className={`px-2 py-0.5 text-left font-semibold ${cloudColorClass(r.cloud)}`}>
                    {CLOUD_LABEL[r.cloud]}
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <CrossCell cross={r.tkCross} />
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <ColorCell color={r.color} />
                  </td>
                  <td className={`px-2 py-0.5 text-right ${changeClass(r.dist)}`}>
                    {r.dist > 0 ? '+' : ''}
                    {r.dist.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        CLOUD = price vs kumo (<span className="text-term-up">above</span> /{' '}
        <span className="text-term-down">below</span> / in) · TK = Tenkan×Kijun cross · CLR = cloud colour · DIST% = close
        from the cloud
      </div>
    </div>
  );
}
