import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { omegaBoard, type OmegaSort } from '@/lib/omega';
import { fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

const omegaColor = (v: number | null) =>
  v == null ? 'text-term-up' : v >= 1 ? 'text-term-up' : 'text-term-down';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: OmegaSort;
  label: string;
  align: 'left' | 'right';
  sort: OmegaSort;
  onSort: (c: OmegaSort) => void;
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

export function OmegaModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [sort, setSort] = useState<OmegaSort>('omega');
  const [thr, setThr] = useState('0'); // threshold, % per day
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

  const threshold = useMemo(() => {
    const t = num(thr);
    return Number.isFinite(t) ? t / 100 : 0; // % per day → fraction
  }, [thr]);

  const rows = useMemo(() => (data ? omegaBoard(data, threshold, sort) : []), [data, threshold, sort]);
  const maxOmega = useMemo(
    () => Math.max(1, ...rows.map((r) => (r.omega == null ? 0 : r.omega))),
    [rows],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to rank return quality by Omega.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Omega · {tf.label} daily</span>
        <label className="flex items-center gap-1">
          <span className="text-term-dim">τ%</span>
          <input
            type="number"
            inputMode="decimal"
            value={thr}
            onChange={(e) => setThr(e.target.value)}
            className="no-drag w-12 rounded-sm border border-term-border bg-term-bg/40 px-1 py-0.5 text-right font-mono text-2xs text-term-text outline-none focus:border-term-amber/60"
          />
        </label>
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
          <EmptyState>Not enough history to compute Omega.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="omega" label="OMEGA" align="right" sort={sort} onSort={setSort} />
                <SortHead col="meanRet" label="RET" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">UP%</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">DN%</th>
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
                  <td className="relative px-2 py-0.5 text-right">
                    <div
                      className="absolute inset-y-0 right-0 bg-term-up/12"
                      style={{ width: `${r.omega == null ? 100 : (r.omega / maxOmega) * 100}%` }}
                    />
                    <span className={`relative font-semibold ${omegaColor(r.omega)}`}>
                      {r.omega == null ? '∞' : r.omega.toFixed(2)}
                    </span>
                  </td>
                  <td className={`px-2 py-0.5 text-right ${r.meanRet >= 0 ? 'text-term-up' : 'text-term-down'}`}>
                    {fmtSignedPercent(r.meanRet * 365 * 100)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-up">{(r.upside * 100).toFixed(0)}%</td>
                  <td className="px-2 py-0.5 text-right text-term-down">{(r.downside * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Ω = Σ gains above τ ÷ Σ shortfalls below τ · &gt;1 favorable · <span className="text-term-up">∞</span> = nothing below τ · RET annualized · τ daily
      </div>
    </div>
  );
}
