import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { sparklinePath } from '@/lib/sparkline';
import { optionsBadge, type OptionsTone } from '@/lib/optionsView';
import { Loading, ErrorMsg } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import type { DvolSnapshot } from '@midas/shared';

const TONE: Record<OptionsTone, string> = {
  live: 'border-term-border text-term-muted',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

function DvolRow({ snapshot }: { snapshot: DvolSnapshot }) {
  const badge = optionsBadge(snapshot.provenance, snapshot.note);
  const path = sparklinePath(
    snapshot.history.map((p) => p.value),
    120,
    24,
  );
  return (
    <div className="flex items-center gap-3 border-b border-term-border/30 px-2 py-2">
      <span className="w-10 font-semibold text-term-text">{snapshot.symbol}</span>
      <span className="w-14 tabular-nums text-lg text-term-text">
        {snapshot.value == null ? '—' : snapshot.value.toFixed(1)}
      </span>
      {path ? (
        <svg width="120" height="24" className="shrink-0" aria-hidden>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1" className="text-term-muted" />
        </svg>
      ) : (
        <span className="text-2xs text-term-dim">no history</span>
      )}
      {snapshot.receipt ? (
        <SourceBadge receipt={snapshot.receipt} compact className="ml-auto" />
      ) : (
        <span className={`ml-auto rounded-sm border px-1.5 py-0.5 text-2xs ${TONE[badge.tone]}`} title={badge.tone === 'live' ? `${badge.detail} Freshness unknown: no receipt.` : badge.detail}>
          {badge.label}{badge.tone === 'live' ? ' · freshness unknown' : ''}
        </span>
      )}
    </div>
  );
}

/**
 * DVOL — Deribit's 30-day forward-looking volatility index for BTC and ETH,
 * with a 30-day sparkline. Live reads come from Deribit regardless of the
 * configured exchange (options are Deribit-native); every payload carries its
 * own provenance badge, and an unavailable index shows an em-dash, never 0.
 */
export function DvolModule() {
  const btc = useFetch((signal) => api.dvol('BTC', signal), [], { intervalMs: 60_000 });
  const eth = useFetch((signal) => api.dvol('ETH', signal), [], { intervalMs: 60_000 });

  const loading = (btc.loading && !btc.data) || (eth.loading && !eth.data);
  const error = (!btc.data && btc.error) || (!eth.data && eth.error);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs text-term-muted">
        <span>Deribit volatility index · 30d forward IV</span>
        <span className="text-term-dim">60s</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading ? (
          <Loading label="Loading DVOL" />
        ) : (
          <>
            {btc.data ? (
              <DvolRow snapshot={btc.data} />
            ) : (
              <div className="border-b border-term-border/30 px-2 py-2 text-2xs text-term-dim">
                BTC DVOL unavailable{btc.error ? ` — ${btc.error}` : ''}
              </div>
            )}
            {eth.data ? (
              <DvolRow snapshot={eth.data} />
            ) : (
              <div className="border-b border-term-border/30 px-2 py-2 text-2xs text-term-dim">
                ETH DVOL unavailable{eth.error ? ` — ${eth.error}` : ''}
              </div>
            )}
          </>
        )}
        {error && !loading && <ErrorMsg message={error} />}
      </div>
      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Annualized expected 30-day volatility (vol points). BTC &amp; ETH options price discovery is Deribit-native.
      </div>
    </div>
  );
}
