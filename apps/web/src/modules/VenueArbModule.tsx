import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { BoardMetaBadge, BoardMetaNote } from '@/components/BoardMeta';
import { SourceBadge } from '@/components/SourceInspector';
import { isActionableVenueArb } from '@/lib/clientArb';
import { isReceiptFresh } from '@/lib/receiptView';
import type { VenuePricePoint } from '@midas/shared';
import type { ModuleProps } from './types';

/** Basis points, e.g. 12.5 → "12.5 bp". */
function fmtBps(bps: number | null): string {
  if (bps == null) return '—';
  return `${bps.toFixed(1)} bp`;
}

/** Signed bps for the crossed/normal spread, e.g. -3.2 → "−3.2 bp". */
function fmtSpread(bps: number | null): string {
  if (bps == null) return '—';
  return `${bps >= 0 ? '+' : '−'}${Math.abs(bps).toFixed(1)} bp`;
}

/** Full per-venue price breakdown for the row's hover title. */
function venuesTitle(venues: VenuePricePoint[]): string {
  return venues.map((v) => `${v.exchange} ${fmtPrice(v.price)}`).join('  ·  ');
}

export function VenueArbModule({ panel }: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.venueArb('USDT', 20, signal),
    [],
    { intervalMs: 10_000 },
  );

  // The server ranks widest-dispersion first — where venues most disagree.
  const rows = data?.rows ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">ARB SCREENER</span>
        {data ? <BoardMetaBadge meta={data.meta} /> : <span className="text-term-dim">cross-venue · USDT</span>}
      </div>
      {data && <BoardMetaNote meta={data.meta} />}
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading venues" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && rows.length === 0 && (
          <EmptyState>No cross-venue price dispersion — a single-venue set for these symbols.</EmptyState>
        )}
        {rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">DISP</th>
                <th className="px-2 py-1 text-right font-normal" title="Lowest ask across venues — buy here">
                  BUY
                </th>
                <th className="px-2 py-1 text-right font-normal" title="Highest bid across venues — sell here">
                  SELL
                </th>
                <th className="px-2 py-1 text-right font-normal">SPREAD</th>
                <th
                  className="px-2 py-1 text-right font-normal"
                  title="SPREAD minus reference taker fees when both leg sizes and timestamps are known"
                >
                  NET
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const actionable = isActionableVenueArb(r);
                const visibleNet = isReceiptFresh(r.receipt) ? r.netSpreadBps : null;
                return (
                <tr
                  key={r.symbol}
                  className={`border-b border-term-border/30 hover:bg-term-header/60 ${
                    actionable ? 'bg-term-up/10' : ''
                  }`}
                  title={venuesTitle(r.venues)}
                >
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                    <span className="ml-1 text-term-dim">·{r.venues.length}</span>
                    {r.receipt && <SourceBadge receipt={r.receipt} compact className="ml-1" />}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-term-amber">
                    {fmtBps(r.dispersionBps)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.bestAsk ? (
                      <>
                        <span className="text-term-accent">{fmtPrice(r.bestAsk.value)}</span>
                        <span className="ml-1 text-term-dim">{r.bestAsk.exchange}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.bestBid ? (
                      <>
                        <span className={actionable ? 'text-term-up' : 'text-term-muted'}>{fmtPrice(r.bestBid.value)}</span>
                        <span className="ml-1 text-term-dim">{r.bestBid.exchange}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtSpread(r.spreadBps)}</td>
                  <td
                    className={`px-2 py-1 text-right font-semibold tabular-nums ${
                      actionable ? 'text-term-up' : 'text-term-muted'
                    }`}
                  >
                    {actionable && (
                      <span className="mr-1 rounded-sm bg-term-up/20 px-1 py-0.5 text-2xs font-semibold uppercase text-term-up">
                        net arb
                      </span>
                    )}
                    {fmtSpread(visibleNet)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        DISP = cross-venue price dispersion (bp) · BUY lowest ask / SELL highest bid · SPREAD &gt; 0 = crossed book (gross) · NET = SPREAD −
        round-trip reference taker fees, only with known size and aligned timestamps (base tier, ignores
        withdrawal/transfer — inspect the receipt)
      </div>
    </div>
  );
}
