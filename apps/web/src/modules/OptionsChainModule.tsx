import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { fmtExpiry, fmtIv, optionsBadge, pcrLabel, type OptionsTone } from '@/lib/optionsView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import { isReceiptActionable } from '@/lib/receiptView';
import type { ModuleProps } from './types';

const TONE: Record<OptionsTone, string> = {
  live: 'border-term-border text-term-muted',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/**
 * OPTChain — the Deribit options chain for a symbol at one expiry: strikes
 * around the money with call/put open interest, USD marks and IV, the max-pain
 * strike highlighted, and the put/call OI ratio as the positioning read. OI is
 * in venue contract units (the contract size cancels out of max pain and PCR).
 * An expiry picker cycles the nearest few weekly expiries.
 */
export function OptionsChainModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  // Weeks out from the nearest Friday expiry (0 = nearest).
  const [weeksOut, setWeeksOut] = useState(0);

  const nearest = useFetch(
    (signal) => api.optionsChain(symbol as string, undefined, signal),
    [symbol],
    { intervalMs: 60_000, enabled: Boolean(symbol) },
  );

  const weekMs = 7 * 86_400_000;
  const targetExpiry = (nearest.data?.expiry ?? 0) + weeksOut * weekMs;

  // Only fetched for weeksOut > 0 (weeksOut === 0 renders the nearest fetch).
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.optionsChain(symbol as string, targetExpiry, signal),
    [symbol, targetExpiry],
    { intervalMs: 60_000, enabled: Boolean(symbol) && weeksOut > 0 && Boolean(nearest.data) },
  );

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  const active = weeksOut === 0 ? nearest.data : data;
  const activeError = weeksOut === 0 ? nearest.error : error;
  const activeLoading = weeksOut === 0 ? nearest.loading : loading;
  const badge = active ? optionsBadge(active.provenance, active.note) : null;
  const actionable = isReceiptActionable(active?.receipt);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">{active?.underlying ?? symbol}</span>
        <span className="text-term-dim">options · expiry {active ? fmtExpiry(active.expiry) : '…'}</span>
        <select
          value={weeksOut}
          onChange={(e) => setWeeksOut(Number(e.target.value))}
          className="no-drag rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-term-text outline-none focus:border-term-amber"
          title="Expiry — weeks out from the nearest"
        >
          {[0, 1, 2, 4].map((w) => (
            <option key={w} value={w}>
              {w === 0 ? 'nearest' : `+${w}w`}
            </option>
          ))}
        </select>
        {active?.receipt ? (
          <SourceBadge receipt={active.receipt} compact className="ml-auto" />
        ) : badge ? (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.tone === 'live' ? `${badge.detail} Freshness unknown: no receipt.` : badge.detail}>
            {badge.label}{badge.tone === 'live' ? ' · freshness unknown' : ''}
          </span>
        ) : null}
      </div>

      {activeLoading && !active ? (
        <Loading label={`Loading ${symbol} options`} />
      ) : activeError && !active ? (
        <ErrorMsg message={activeError} onRetry={weeksOut === 0 ? nearest.refresh : refresh} />
      ) : !active || active.entries.length === 0 ? (
        <EmptyState>{active?.note ?? `No options chain for ${symbol}.`}</EmptyState>
      ) : (
        <div className="scroll-term flex-1 overflow-auto">
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-right font-normal">CALL OI</th>
                <th className="px-2 py-1 text-right font-normal">CALL</th>
                <th className="px-2 py-1 text-right font-normal">STRIKE</th>
                <th className="px-2 py-1 text-right font-normal">PUT</th>
                <th className="px-2 py-1 text-right font-normal">PUT OI</th>
                <th className="px-2 py-1 text-right font-normal">IV</th>
              </tr>
            </thead>
            <tbody>
              {active.entries.map((e) => {
                const isMaxPain = active.maxPainStrike === e.strike;
                const itm = active.underlyingPrice != null && e.strike < active.underlyingPrice;
                return (
                  <tr
                    key={e.strike}
                    className={`border-b border-term-border/20 hover:bg-term-header/40 ${
                      isMaxPain && actionable ? 'bg-term-amber/10' : ''
                    }`}
                    title={isMaxPain ? 'Max pain — the expiry price minimizing option-buyer payout' : undefined}
                  >
                    <td className="px-2 py-0.5 text-right text-term-muted">{e.callOi == null ? '—' : fmtCompact(e.callOi)}</td>
                    <td className={`px-2 py-0.5 text-right ${itm ? 'text-term-text' : 'text-term-dim'}`}>
                      {e.callMark == null ? '—' : fmtPrice(e.callMark)}
                    </td>
                    <td className={`px-2 py-0.5 text-right font-medium ${isMaxPain ? (actionable ? 'text-term-amber' : 'text-term-muted') : 'text-term-text'}`}>
                      {fmtCompact(e.strike)}
                      {isMaxPain ? (actionable ? ' ◆' : ' ◇') : ''}
                    </td>
                    <td className={`px-2 py-0.5 text-right ${!itm ? 'text-term-text' : 'text-term-dim'}`}>
                      {e.putMark == null ? '—' : fmtPrice(e.putMark)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{e.putOi == null ? '—' : fmtCompact(e.putOi)}</td>
                    <td className="px-2 py-0.5 text-right text-term-dim">{fmtIv(e.iv)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {active && active.entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <span>
            max pain{' '}
            <span className={actionable ? 'text-term-amber' : 'text-term-muted'}>
              {active.maxPainStrike == null ? '—' : fmtCompact(active.maxPainStrike)}
            </span>
          </span>
          <span>
            PCR{' '}
            <span className={actionable ? 'text-term-text' : 'text-term-muted'}>
              {active.putCallOiRatio == null ? '—' : active.putCallOiRatio.toFixed(2)}
            </span>{' '}
            <span>({pcrLabel(active.putCallOiRatio)})</span>
          </span>
          <span className="ml-auto">OI in venue contracts · marks USD</span>
        </div>
      )}
    </div>
  );
}
