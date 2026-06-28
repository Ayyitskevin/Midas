import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { roofBoard, type RoofSort, type RoofCross } from '@/lib/roof';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const HP_PERIOD = 48;
const SMOOTHERS: { label: string; ssPeriod: number }[] = [
  { label: '10', ssPeriod: 10 },
  { label: '20', ssPeriod: 20 },
];

const signalClass = (v: number) => (v >= 0 ? 'text-term-up' : 'text-term-down');

function CrossCell({ cross }: { cross: RoofCross }) {
  if (cross === 'bull') return <span className="text-term-up">▲ BULL</span>;
  if (cross === 'bear') return <span className="text-term-down">▼ BEAR</span>;
  return <span className="text-term-dim">·</span>;
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: RoofSort;
  label: string;
  align: 'left' | 'right';
  sort: RoofSort;
  onSort: (c: RoofSort) => void;
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

export function RoofModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [smIdx, setSmIdx] = useState(0); // default SuperSmoother period 10
  const [sort, setSort] = useState<RoofSort>('roof');
  const sm = SMOOTHERS[smIdx];

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
    () => (data ? roofBoard(data, sort, HP_PERIOD, sm.ssPeriod) : []),
    [data, sort, sm.ssPeriod],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Ehlers Roofing Filter.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Ehlers Roofing Filter · HP 48 / SS {sm.label}</span>
        <div className="ml-auto flex gap-1">
          {SMOOTHERS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setSmIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === smIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history for the Ehlers Roofing Filter.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="roof" label="ROOF" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">TRIG</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${signalClass(r.signal)}`}>
                    {r.signal.toFixed(2)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.trigger.toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-center font-semibold">
                    <CrossCell cross={r.cross} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Roofing Filter · high-pass (48) strips trend, SuperSmoother ({sm.label}) strips noise · AGC-normalized to{' '}
        <span className="text-term-up">±1</span> · &gt; 0 up-cycle / &lt; 0 down-cycle · TRIG = prior bar · sorts
        highest first
      </div>
    </div>
  );
}
