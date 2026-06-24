import { useState } from 'react';
import type { ScreenerRow } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { buildOverview } from '@/lib/marketOverview';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const QUOTES = ['USDT', 'BTC'];
const TOP_N = 8;

/** A titled mini-table of movers; symbols navigate the panel's link group. */
function MoverList({
  title,
  accent,
  rows,
  showVol,
  onPick,
}: {
  title: string;
  accent: string;
  rows: ScreenerRow[];
  showVol?: boolean;
  onPick: (symbol: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className={`px-2 py-1 text-2xs font-semibold uppercase tracking-wide ${accent}`}>
        {title}
      </div>
      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="px-2 py-1 text-2xs text-term-dim">—</div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-0.5">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => onPick(r.symbol)}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td className="px-1 py-0.5 text-right tabular-nums text-term-muted">
                    {showVol ? `$${fmtCompact(r.quoteVolume)}` : fmtPrice(r.price)}
                  </td>
                  <td className={`px-2 py-0.5 text-right tabular-nums ${changeClass(r.changePercent)}`}>
                    {fmtSignedPercent(r.changePercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function MarketOverviewModule({ panel }: ModuleProps) {
  const [quote, setQuote] = useState('USDT');

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.screener(quote, 'volume', 200, signal),
    [quote],
    { intervalMs: 15_000 },
  );

  const overview = data ? buildOverview(data, TOP_N) : null;
  const pick = (symbol: string) => navigate(panel, symbol);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">MARKET OVERVIEW</span>
        <div className="flex gap-1">
          {QUOTES.map((qc) => (
            <button
              key={qc}
              onClick={() => setQuote(qc)}
              className={`rounded-sm px-1.5 py-0.5 ${
                quote === qc ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {qc}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Loading label="Loading market" />}
      {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
      {data && data.length === 0 && <EmptyState>No {quote} markets.</EmptyState>}

      {overview && data && data.length > 0 && (
        <>
          {/* Breadth band */}
          <div className="border-b border-term-border px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between text-2xs tabular-nums">
              <span>
                <span className="text-term-up">{overview.breadth.advancers} adv</span>
                <span className="mx-1 text-term-dim">·</span>
                <span className="text-term-down">{overview.breadth.decliners} dec</span>
                {overview.breadth.unchanged > 0 && (
                  <>
                    <span className="mx-1 text-term-dim">·</span>
                    <span className="text-term-muted">{overview.breadth.unchanged} unch</span>
                  </>
                )}
              </span>
              <span className={changeClass(overview.breadth.avgChange)}>
                avg {fmtSignedPercent(overview.breadth.avgChange)}
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-sm bg-term-border">
              <div
                className="bg-term-up"
                style={{ width: `${overview.breadth.advancingPct * 100}%` }}
                title={`${overview.breadth.advancers} advancing`}
              />
              <div
                className="bg-term-down"
                style={{
                  width: `${
                    overview.breadth.total > 0
                      ? (overview.breadth.decliners / overview.breadth.total) * 100
                      : 0
                  }%`,
                }}
                title={`${overview.breadth.decliners} declining`}
              />
            </div>
          </div>

          {/* Movers */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-term-border lg:grid-cols-3">
            <div className="bg-term-panel">
              <MoverList title="Top Gainers" accent="text-term-up" rows={overview.gainers} onPick={pick} />
            </div>
            <div className="bg-term-panel">
              <MoverList title="Top Losers" accent="text-term-down" rows={overview.losers} onPick={pick} />
            </div>
            <div className="bg-term-panel">
              <MoverList title="Most Active" accent="text-term-muted" rows={overview.mostActive} showVol onPick={pick} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
