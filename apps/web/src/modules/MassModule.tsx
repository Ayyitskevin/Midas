import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { massBoard, type MassSort, type MassState } from '@/lib/massIndex';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; emaPeriod: number }[] = [
  { label: '9', emaPeriod: 9 }, // Dorsey standard
  { label: '7', emaPeriod: 7 }, // faster
];
const SUM = 25;
const BULGE = 27;
const TRIGGER = 26.5;

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: MassSort;
  label: string;
  align: 'left' | 'right';
  sort: MassSort;
  onSort: (c: MassSort) => void;
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

function StateCell({ state }: { state: MassState }) {
  if (state === 'fired') return <span className="font-semibold text-term-amber">FIRE</span>;
  if (state === 'bulge') return <span className="text-term-amber">BULGE</span>;
  if (state === 'setup') return <span className="text-term-muted">SETUP</span>;
  return <span className="text-term-dim">·</span>;
}

export function MassModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default EMA 9
  const [sort, setSort] = useState<MassSort>('mass');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, bars: h.candles.map((c) => ({ high: c.high, low: c.low })) }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? massBoard(data, sort, preset.emaPeriod, SUM, BULGE, TRIGGER) : []),
    [data, sort, preset.emaPeriod],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Mass Index.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Mass Index · EMA {preset.label} · sum {SUM}</span>
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
          <EmptyState>Not enough history to compute the Mass Index.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="mass" label="MASS" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">STATE</th>
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
                  <td
                    className={`px-2 py-0.5 text-right font-semibold ${
                      r.mass >= BULGE ? 'text-term-amber' : 'text-term-text'
                    }`}
                  >
                    {r.mass.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <StateCell state={r.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Mass Index = Σ EMA(range)/EMA(EMA(range)) over {SUM} · <span className="text-term-amber">BULGE ≥ 27</span> then{' '}
        <span className="text-term-amber">FIRE</span> &lt; 26.5 warns of a reversal
      </div>
    </div>
  );
}
