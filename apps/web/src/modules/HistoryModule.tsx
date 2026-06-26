import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { buildHistory, historySummary, type HistorySort } from '@/lib/history';
import { fmtPrice, fmtCompact, fmtSignedPercent, changeClass } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TIMEFRAMES: { label: string; interval: Interval; range: Range; intraday: boolean }[] = [
  { label: '5D', interval: '60m', range: '5d', intraday: true },
  { label: '1M', interval: '1d', range: '1mo', intraday: false },
  { label: '3M', interval: '1d', range: '3mo', intraday: false },
  { label: '1Y', interval: '1d', range: '1y', intraday: false },
  { label: '5Y', interval: '1wk', range: '5y', intraday: false },
];

const fmtRowDate = (ms: number, intraday: boolean): string => {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit', timeZone: 'UTC' });
  if (!intraday) return date;
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date} ${time}`;
};

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: HistorySort;
  label: string;
  align: 'left' | 'right';
  sort: HistorySort;
  onSort: (c: HistorySort) => void;
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

export function HistoryModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(3); // default 1Y
  const [sort, setSort] = useState<HistorySort>('time');
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, tf.interval, tf.range, signal),
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const candles = data?.candles ?? [];
  const rows = useMemo(() => buildHistory(candles, sort, 'desc'), [candles, sort]);
  const summary = useMemo(() => historySummary(candles), [candles]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!summary || rows.length === 0) return <EmptyState>No price history for {symbol}.</EmptyState>;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">historical prices · {summary.n} bars</span>
        <div className="ml-auto flex items-center gap-1">
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

      {/* Period summary strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-term-border px-2 py-1 text-term-muted">
        <span>
          H <span className="text-term-text">{fmtPrice(summary.periodHigh)}</span>
        </span>
        <span>
          L <span className="text-term-text">{fmtPrice(summary.periodLow)}</span>
        </span>
        <span>
          Δ <span className={changeClass(summary.totalChangePct)}>{fmtSignedPercent(summary.totalChangePct)}</span>
        </span>
        <span>
          Vol⌀ <span className="text-term-text">{fmtCompact(summary.avgVolume)}</span>
        </span>
        <span>
          <span className="text-term-up">{summary.upDays}▲</span> / <span className="text-term-down">{summary.downDays}▼</span>
        </span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        <table className="w-full tabular-nums">
          <thead className="sticky top-0 bg-term-panel">
            <tr>
              <SortHead col="time" label="DATE" align="left" sort={sort} onSort={setSort} />
              <th className="px-2 py-1 text-right font-normal text-term-muted">OPEN</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">HIGH</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">LOW</th>
              <th className="px-2 py-1 text-right font-normal text-term-muted">CLOSE</th>
              <SortHead col="change" label="CHG%" align="right" sort={sort} onSort={setSort} />
              <SortHead col="volume" label="VOL" align="right" sort={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.time} className="border-b border-term-border/20 hover:bg-term-header/40">
                <td className="px-2 py-0.5 text-left text-term-text">{fmtRowDate(r.time, tf.intraday)}</td>
                <td className="px-2 py-0.5 text-right text-term-muted">{fmtPrice(r.open)}</td>
                <td className="px-2 py-0.5 text-right text-term-up">{fmtPrice(r.high)}</td>
                <td className="px-2 py-0.5 text-right text-term-down">{fmtPrice(r.low)}</td>
                <td className="px-2 py-0.5 text-right font-semibold text-term-text">{fmtPrice(r.close)}</td>
                <td className={`px-2 py-0.5 text-right ${changeClass(r.changePct)}`}>
                  {r.changePct === null ? '—' : fmtSignedPercent(r.changePct)}
                </td>
                <td className="px-2 py-0.5 text-right text-term-muted">{fmtCompact(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        OHLCV history · CHG% vs the prior bar's close · click DATE / CHG% / VOL to sort · the tabular complement to the chart (G).
      </div>
    </div>
  );
}
