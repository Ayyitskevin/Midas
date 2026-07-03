import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { solanaBadge, SOLANA_TONE_CLASS } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

// Base-58 sanity check (the server is the source of truth). Case-sensitive:
// the address is NEVER uppercased — that would corrupt a valid key.
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// A well-known address (the SOL wrapped-token mint authority) so the demo has
// something to show on first open without the user pasting anything.
const SAMPLE = 'So11111111111111111111111111111111111111112';

/**
 * Read-only Solana wallet inspector (SWAL) — paste a public base-58 address to
 * see its SOL balance and SPL token holdings, priced to USD where sourceable.
 * Non-custodial by construction: no key, no signing, no writes; the address is
 * a local input (never the command symbol, which the terminal uppercases).
 */
export function SolanaWalletModule(_props: ModuleProps) {
  const [draft, setDraft] = useState(SAMPLE);
  const [address, setAddress] = useState(SAMPLE);
  const valid = ADDRESS_RE.test(address);

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaWallet(address, signal),
    [address],
    { intervalMs: 30_000, enabled: valid },
  );
  const badge = data ? solanaBadge(data) : null;

  const submit = () => {
    const a = draft.trim();
    if (ADDRESS_RE.test(a)) setAddress(a);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Solana wallet</span>
        <input
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Paste a base-58 address…"
          aria-label="Solana wallet address"
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

      {data && (
        <div className="flex items-center gap-3 border-b border-term-border px-2 py-0.5 text-2xs text-term-dim">
          <span>
            SOL <span className="text-term-text tabular-nums">{data.solBalance == null ? '—' : data.solBalance.toFixed(4)}</span>
          </span>
          <span>
            Total{' '}
            <span className="text-term-text tabular-nums">
              {data.totalValueUsd == null ? '—' : `$${fmtCompact(data.totalValueUsd)}`}
            </span>
          </span>
          <span className="ml-auto text-term-dim">read-only · non-custodial</span>
        </div>
      )}

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {!valid ? (
          <EmptyState>Paste a Solana public address (base-58, 32–44 chars) to inspect it.</EmptyState>
        ) : loading && !data ? (
          <Loading label="Loading wallet" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Wallet data unavailable.'}</EmptyState>
        ) : data.tokens.length === 0 ? (
          <EmptyState>No SPL token holdings found for this address.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">TOKEN</th>
                <th className="px-2 py-1 text-right font-normal">AMOUNT</th>
                <th className="px-2 py-1 text-right font-normal">VALUE</th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr key={t.mint} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-term-text" title={t.mint}>
                    {t.symbol}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {t.amount == null ? '—' : fmtCompact(t.amount)}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    {t.valueUsd == null ? <span className="text-term-dim">unpriced</span> : fmtPrice(t.valueUsd)}
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
