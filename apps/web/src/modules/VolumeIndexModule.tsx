import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { volumeIndexBoard, type VolIdxSort, type Regime } from '@/lib/volumeIndex';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '2y'; // the NVI/PVI signal EMA is classically 255 bars

const PRESETS: { label: string; signalPeriod: number }[] = [
  { label: '255', signalPeriod: 255 }, // Fosback standard (~1y)
  { label: '100', signalPeriod: 100 }, // shorter
];

function RegimeCell({ regime }: { regime: Regime }) {
  return regime === 'bull' ? <span className="text-term-up">▲</span> : <span className="text-term-down">▼</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: VolIdxSort;
  label: string;
  align: 'left' | 'right';
  sort: VolIdxSort;
  onSort: (c: VolIdxSort) => void;
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

export function VolumeIndexModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 255
  const [sort, setSort] = useState<VolIdxSort>('nvi');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, bars: h.candles.map((c) => ({ close: c.close, volume: c.volume })) }))
            .catch(() => ({ symbol: s, bars: [] as { close: number; volume: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? volumeIndexBoard(data, sort, preset.signalPeriod) : []),
    [data, sort, preset.signalPeriod],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Volume Index (NVI/PVI).</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Volume Index · NVI/PVI · signal {preset.label}</span>
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
          <EmptyState>Not enough history for the Volume Index.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="nvi" label="NVI%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">NVI</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">PVI</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.nviDist)}`}>
                    {r.nviDist > 0 ? '+' : ''}
                    {r.nviDist.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <RegimeCell regime={r.nviRegime} />
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <RegimeCell regime={r.pviRegime} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        NVI% = NVI vs its {preset.label}-EMA · NVI (smart money, down-vol days) / PVI (crowd, up-vol days){' '}
        <span className="text-term-up">▲</span> above EMA = bull regime
      </div>
    </div>
  );
}
