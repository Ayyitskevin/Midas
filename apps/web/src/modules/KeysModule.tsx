import { useState, type FormEvent } from 'react';
import type { AccountKeysInput } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { classifyKeysError, maskKey, validateKeysInput } from '@/lib/keysView';
import { useToasts } from '@/store/useToasts';
import { EmptyState, Loading } from '@/components/Feedback';
import { fmtTimeAgo } from '@/lib/format';

const inputCls =
  'no-drag w-full rounded-sm border border-term-border bg-term-bg px-2 py-1 text-xs text-term-text outline-none focus:border-term-amber';

/**
 * KEYS — manage your own exchange API keys on a shared/hosted Midas: save
 * (write-only; encrypted at rest server-side and never shown again), inspect
 * the metadata, delete in one action. With keys stored, BAL/ORD/POSN/FILLS
 * read YOUR account. Execution is held server-side.
 */
export function KeysModule() {
  const pushToast = useToasts((s) => s.push);
  const { data, error, loading, refresh } = useFetch((signal) => api.accountKeys(signal), []);

  const [exchange, setExchange] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [canTrade, setCanTrade] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const input: AccountKeysInput = {
      exchange: exchange.trim().toLowerCase(),
      apiKey: apiKey.trim(),
      secret: secret.trim(),
      ...(password.trim() ? { password: password.trim() } : {}),
      canTrade,
    };
    const errs = validateKeysInput(input);
    setProblems(errs);
    if (errs.length > 0) return;
    setBusy(true);
    try {
      const meta = await api.saveAccountKeys(input);
      // The secrets' only client-side life ends here.
      setApiKey('');
      setSecret('');
      setPassword('');
      setReplacing(false);
      pushToast({
        title: 'Exchange keys saved',
        body: `${meta.exchange} ····${meta.keyLast4} — encrypted at rest, never shown again. Account panels now read your account.`,
        tone: 'up',
      });
      refresh();
    } catch (err) {
      pushToast({ title: 'Keys not saved', body: (err as Error).message, tone: 'down' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteAccountKeys();
      pushToast({
        title: 'Exchange keys deleted',
        body: 'Your stored keys are gone; account panels fall back to the server default.',
        tone: 'up',
      });
      refresh();
    } catch (err) {
      pushToast({ title: 'Delete failed', body: (err as Error).message, tone: 'down' });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading label="Loading key status" />;

  if (error && !data) {
    const kind = classifyKeysError(error);
    if (kind === 'feature-off') {
      return (
        <EmptyState>
          Per-user keys are off on this server — the operator must set{' '}
          <span className="font-mono">MIDAS_KEYS_KMS_SECRET</span> (they're encrypted at rest with it). Self-hosting
          solo? The env keys (<span className="font-mono">MIDAS_CCXT_API_KEY</span>) work without this panel.
        </EmptyState>
      );
    }
    if (kind === 'needs-auth') {
      return <EmptyState>Sign in first — per-user keys belong to your login. Run AUTH to sign in.</EmptyState>;
    }
    return <EmptyState>Can't reach the key store — {error}</EmptyState>;
  }

  const keys = data?.keys ?? null;
  const showForm = keys == null || replacing;

  return (
    <div className="scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2 text-xs">
      {keys && (
        <div className="rounded-sm border border-term-border p-2">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold uppercase text-term-text">{keys.exchange}</span>
            <span className="font-mono text-term-muted">{maskKey(keys.keyLast4)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-2xs">
            <span className={keys.canTrade ? 'text-term-amber' : 'text-term-up'}>
              {keys.canTrade ? 'trade permission recorded · execution held' : 'read-only'}
            </span>
            <span className="text-term-dim">saved {fmtTimeAgo(keys.createdAt)}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setReplacing((v) => !v)}
              className="no-drag rounded-sm border border-term-border px-2 py-0.5 text-2xs text-term-muted hover:border-term-amber hover:text-term-amber"
            >
              {replacing ? 'keep current' : 'replace…'}
            </button>
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="no-drag rounded-sm border border-term-border px-2 py-0.5 text-2xs text-term-muted hover:border-term-down hover:text-term-down disabled:opacity-50"
            >
              delete keys
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={save} className="space-y-1.5">
          <div className="text-2xs text-term-dim">
            Keys are sent once, encrypted at rest with the server's KMS secret, and never displayed again — only the
            exchange and last 4 come back. Use keys <span className="text-term-text">without withdrawal permission</span>,
            IP-allowlisted at the exchange.
          </div>
          <input
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            placeholder="exchange (ccxt id, e.g. binance)"
            autoComplete="off"
            className={inputCls}
          />
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key"
            autoComplete="off"
            className={inputCls}
          />
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="API secret"
            type="password"
            autoComplete="new-password"
            className={inputCls}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="passphrase (only some venues, e.g. OKX)"
            type="password"
            autoComplete="new-password"
            className={inputCls}
          />
          <label
            className="no-drag flex items-start gap-1.5 text-2xs text-term-muted"
            title="Records exchange-key metadata for future compatibility. It does not bypass the server execution safety hold."
          >
            <input type="checkbox" checked={canTrade} onChange={(e) => setCanTrade(e.target.checked)} className="mt-0.5" />
            <span>
              record that this exchange key has trade permission (execution remains held; never use withdrawal permission)
            </span>
          </label>
          {problems.length > 0 && (
            <div className="rounded-sm border border-term-down/40 px-2 py-1 text-2xs text-term-down">
              {problems.map((p) => (
                <div key={p}>⚠ {p}</div>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="no-drag rounded-sm border border-term-amber px-3 py-1 text-2xs font-semibold text-term-amber hover:bg-term-amber hover:text-term-bg disabled:opacity-50"
          >
            {busy ? 'Saving…' : keys ? 'Replace keys' : 'Save keys'}
          </button>
        </form>
      )}

      <div className="mt-auto border-t border-term-border/30 pt-1.5 text-2xs text-term-dim">
        Non-custodial and read-only: execution is held and Midas can never withdraw. Your keys never appear in any API
        response or log after this save.
      </div>
    </div>
  );
}
