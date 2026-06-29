import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { useSavedScans } from '@/store/useSavedScans';
import {
  signalBoard,
  filterSignals,
  isActiveCriteria,
  ANY_CRITERIA,
  type SignalSort,
  type RsiState,
  type RangeState,
  type Trend,
  type ScanCriteria,
} from '@/lib/signals';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const rsiColor = (s: RsiState | null) =>
  s === 'overbought' ? 'text-term-down' : s === 'oversold' ? 'text-term-up' : 'text-term-muted';
const rangeFill = (s: RangeState | null) =>
  s === 'high' ? 'rgba(255,176,0,0.3)' : s === 'low' ? 'rgba(38,194,129,0.3)' : 'rgba(122,127,135,0.25)';

// Cycle option lists for the categorical criteria (click a chip to advance).
const TREND_OPTS: Array<{ v: Trend | 'any'; label: string }> = [
  { v: 'any', label: 'any' },
  { v: 'up', label: '▲ up' },
  { v: 'down', label: '▼ dn' },
];
const RSI_OPTS: Array<{ v: RsiState | 'any'; label: string }> = [
  { v: 'any', label: 'any' },
  { v: 'oversold', label: 'oversold' },
  { v: 'overbought', label: 'overbought' },
  { v: 'neutral', label: 'neutral' },
];
const RANGE_OPTS: Array<{ v: RangeState | 'any'; label: string }> = [
  { v: 'any', label: 'any' },
  { v: 'low', label: 'low' },
  { v: 'mid', label: 'mid' },
  { v: 'high', label: 'high' },
];

const labelOf = <T,>(opts: Array<{ v: T; label: string }>, v: T) => opts.find((o) => o.v === v)?.label ?? 'any';
const nextOf = <T,>(opts: Array<{ v: T; label: string }>, v: T): T =>
  opts[(opts.findIndex((o) => o.v === v) + 1) % opts.length].v;

function Chip({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  const set = value !== 'any';
  return (
    <button
      onClick={onClick}
      className={`no-drag rounded-sm border px-1.5 py-0.5 ${
        set
          ? 'border-term-amber/60 text-term-amber'
          : 'border-term-border text-term-muted hover:border-term-amber hover:text-term-text'
      }`}
    >
      <span className="text-term-dim">{label} </span>
      {value}
    </button>
  );
}

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: SignalSort;
  label: string;
  align: 'left' | 'right';
  sort: SignalSort;
  onSort: (c: SignalSort) => void;
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

export function ScanModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const scans = useSavedScans((s) => s.scans);
  const saveScan = useSavedScans((s) => s.save);
  const removeScan = useSavedScans((s) => s.remove);

  const [sort, setSort] = useState<SignalSort>('score');
  const [criteria, setCriteria] = useState<ScanCriteria>(ANY_CRITERIA);
  const [name, setName] = useState('');

  const setCrit = (patch: Partial<ScanCriteria>) => setCriteria((c) => ({ ...c, ...patch }));

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, '1d', '1y', signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const allRows = useMemo(() => (data ? signalBoard(data, sort) : []), [data, sort]);
  const rows = useMemo(() => filterSignals(allRows, criteria), [allRows, criteria]);
  const active = isActiveCriteria(criteria);
  const trimmed = name.trim();
  const isSaved = scans.some((s) => s.name === trimmed);

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to scan for technical signals.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">signal scan · daily</span>
        <span className="ml-auto text-term-dim">SMA20/50 · RSI14 · 52w</span>
      </div>

      {/* Criteria filters — click a chip to cycle; score is a numeric floor. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-term-border px-2 py-1 text-2xs">
        <Chip
          label="trend"
          value={labelOf(TREND_OPTS, criteria.trend)}
          onClick={() => setCrit({ trend: nextOf(TREND_OPTS, criteria.trend) })}
        />
        <Chip
          label="rsi"
          value={labelOf(RSI_OPTS, criteria.rsi)}
          onClick={() => setCrit({ rsi: nextOf(RSI_OPTS, criteria.rsi) })}
        />
        <Chip
          label="range"
          value={labelOf(RANGE_OPTS, criteria.range)}
          onClick={() => setCrit({ range: nextOf(RANGE_OPTS, criteria.range) })}
        />
        <label className="flex items-center gap-1 text-term-dim">
          score≥
          <input
            type="number"
            value={criteria.minScore ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCrit({ minScore: e.target.value === '' || Number.isNaN(n) ? null : n });
            }}
            className="no-drag w-10 rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-term-text outline-none focus:border-term-amber"
          />
        </label>
        <span className="ml-auto text-term-dim">
          <span className="text-term-text">{rows.length}</span>
          {active ? `/${allRows.length}` : ''} match
        </span>
        {active && (
          <button
            onClick={() => setCriteria(ANY_CRITERIA)}
            className="no-drag text-term-muted hover:text-term-amber"
          >
            clear
          </button>
        )}
      </div>

      {/* Saved scans — load by name, or name + save the current criteria. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">saved</span>
        <select
          value={isSaved ? trimmed : ''}
          onChange={(e) => {
            const sc = scans.find((s) => s.name === e.target.value);
            if (sc) {
              setCriteria(sc.criteria);
              setName(sc.name);
            }
          }}
          className="no-drag rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-term-text outline-none focus:border-term-amber"
        >
          <option value="">{scans.length ? 'load…' : 'none yet'}</option>
          {scans.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          className="no-drag w-24 rounded-sm border border-term-border bg-term-panel px-1.5 py-0.5 text-term-text outline-none focus:border-term-amber"
        />
        <button
          onClick={() => trimmed && saveScan(trimmed, criteria)}
          disabled={!trimmed}
          className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted enabled:hover:border-term-amber enabled:hover:text-term-amber disabled:opacity-40"
        >
          {isSaved ? 'update' : 'save'}
        </button>
        {isSaved && (
          <button
            onClick={() => {
              removeScan(trimmed);
              setName('');
            }}
            title="Delete saved scan"
            className="no-drag text-term-muted hover:text-term-down"
          >
            ×
          </button>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : allRows.length === 0 ? (
          <EmptyState>No history to scan.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No symbols match the scan criteria.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="score" label="TREND" align="right" sort={sort} onSort={setSort} />
                <SortHead col="rsi" label="RSI" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-left font-normal text-term-muted">52W</th>
                <SortHead col="range" label="%" align="right" sort={sort} onSort={setSort} />
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
                      r.trend === 'up' ? 'text-term-up' : r.trend === 'down' ? 'text-term-down' : 'text-term-muted'
                    }`}
                  >
                    {r.trend === 'up' ? '▲ up' : r.trend === 'down' ? '▼ dn' : '—'}
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${rsiColor(r.rsiState)}`}>
                    {r.rsi == null ? '—' : r.rsi.toFixed(0)}
                  </td>
                  <td className="px-2 py-0.5">
                    <div className="relative h-3 w-full rounded-sm bg-term-bg/60">
                      {r.rangePct != null && (
                        <div
                          className="absolute inset-y-0 left-0 rounded-sm"
                          style={{ width: `${Math.max(2, r.rangePct)}%`, background: rangeFill(r.rangeState) }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {r.rangePct == null ? '—' : `${r.rangePct.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        <span className="text-term-up">▲</span> SMA20&gt;50 · RSI <span className="text-term-up">≤30</span>/
        <span className="text-term-down">≥70</span> · 52w range · filter &amp; save scans you re-run
      </div>
    </div>
  );
}
