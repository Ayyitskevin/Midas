import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { solanaBadge, SOLANA_TONE_CLASS } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

// Base-58 sanity check (the server is the source of truth). Case-sensitive:
// a mint address is NEVER uppercased — that would corrupt a valid key.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// USDC's mint, so the panel shows something real on first open.
const SAMPLE = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** A mint/freeze authority row — the headline safety signal for a token. */
function Authority({ label, active, hint }: { label: string; active: boolean | null; hint: string }) {
  const text = active == null ? '—' : active ? 'Active' : 'Revoked';
  // An active mint/freeze authority is the riskier state (supply can grow /
  // accounts can be frozen); revoked is the safer one. Color accordingly.
  const tone = active == null ? 'text-term-dim' : active ? 'text-term-amber' : 'text-term-up';
  return (
    <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5" title={hint}>
      <span className="text-2xs uppercase tracking-wide text-term-muted">{label}</span>
      <span className={`text-sm ${tone}`}>{text}</span>
    </div>
  );
}

/**
 * SPL token (mint) explorer — supply, decimals, program and the two authorities
 * that decide token safety: an active mint authority means supply can still be
 * inflated; an active freeze authority means holder accounts can be frozen.
 * Read-only (getTokenSupply + getAccountInfo RPC), non-custodial. Holder count
 * is intentionally not shown — a reliable count needs an indexer, not a public RPC.
 */
export function SolanaTokenModule(_props: ModuleProps) {
  const [draft, setDraft] = useState(SAMPLE);
  const [mint, setMint] = useState(SAMPLE);
  const valid = MINT_RE.test(mint);

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaToken(mint, signal),
    [mint],
    { intervalMs: 60_000, enabled: valid },
  );
  const badge = data ? solanaBadge(data) : null;

  const submit = () => {
    const m = draft.trim();
    if (MINT_RE.test(m)) setMint(m);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">SPL token</span>
        <input
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Paste a mint address…"
          aria-label="SPL mint address"
          className="no-drag min-w-0 flex-1 rounded-sm border border-term-border bg-term-panel px-1 py-0.5 font-mono text-term-text outline-none focus:border-term-amber"
        />
        <button
          onClick={submit}
          className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted hover:text-term-amber"
        >
          Load
        </button>
        {badge && (
          <span className={`rounded-sm border px-1.5 py-0.5 ${SOLANA_TONE_CLASS[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {!valid ? (
          <EmptyState>Paste an SPL mint address (base-58, 32–44 chars) to inspect it.</EmptyState>
        ) : loading && !data ? (
          <Loading label="Loading token" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Token data unavailable.'}</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-term-text">{data.symbol}</span>
              {data.priceUsd != null && <span className="text-2xs text-term-muted tabular-nums">{fmtPrice(data.priceUsd)}</span>}
              {data.program && <span className="ml-auto text-2xs text-term-dim">{data.program}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5">
                <span className="text-2xs uppercase tracking-wide text-term-muted">Supply</span>
                <span className="text-sm text-term-text tabular-nums">{data.supply == null ? '—' : fmtCompact(data.supply)}</span>
              </div>
              <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5">
                <span className="text-2xs uppercase tracking-wide text-term-muted">Decimals</span>
                <span className="text-sm text-term-text tabular-nums">{data.decimals ?? '—'}</span>
              </div>
              <Authority
                label="Mint authority"
                active={data.mintAuthorityActive}
                hint="Active → new supply can still be minted (inflatable). Revoked → supply is fixed."
              />
              <Authority
                label="Freeze authority"
                active={data.freezeAuthorityActive}
                hint="Active → holder accounts can be frozen. Revoked/None → they can't."
              />
            </div>
            <div className="break-all font-mono text-2xs text-term-dim" title={data.mint}>
              {data.mint}
            </div>
          </div>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          Read-only · non-custodial · holder count needs an indexer (not shown)
        </div>
      )}
    </div>
  );
}
