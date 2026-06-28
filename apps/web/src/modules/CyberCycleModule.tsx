import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { cyberCycleBoard, type CyberCycleSort, type CyberCycleCross } from '@/lib/cybercycle';
import { changeClass } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const ALPHAS: { label: string; alpha: number }[] = [
  { label: '.07', alpha: 0.07 },
  { label: '.14', alpha: 0.14 },
];

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: CyberCycleSort;
  label: string;
  align: 'left' | 'right';
  sort: CyberCycleSort;
  onSort: (c: CyberCycleSort) => void;
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

function CrossCell({ cross }: { cross: CyberCycleCross }) {
  if (cross === 'bull') return <span className="text-term-up">↑</span>;
  if (cross === 'bear') return <span className="text-term-down">↓</span>;
  return <span className="text-term-dim">·</span>;
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export function CyberCycleModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [alphaIdx, setAlphaIdx] = useState(0); // default alpha 0.07
  const [sort, setSort] = useState<CyberCycleSort>('cycle');
  const a = ALPHAS[alphaIdx];

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

  const rows = useMemo(() => (data ? cyberCycleBoard(data, sort, a.alpha) : []), [data, sort, a.alpha]);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Cyber Cycle.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Ehlers Cyber Cycle · α {a.label}</span>
        <div className="ml-auto flex gap-1">
          {ALPHAS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setAlphaIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === alphaIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
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
          <EmptyState>Not enough history for the Cyber Cycle.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="cycle" label="CYCLE%" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">TRIG%</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${changeClass(r.cyclePct)}`}>
                    {signed(r.cyclePct)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{signed(r.trigPct)}</td>
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
        Ehlers Cyber Cycle (dominant-cycle band-pass) · CYCLE% = cycle as % of price · TRIG% = prior cycle · CRS{' '}
        <span className="text-term-up">↑</span>/<span className="text-term-down">↓</span> = cycle turned
      </div>
    </div>
  );
}
