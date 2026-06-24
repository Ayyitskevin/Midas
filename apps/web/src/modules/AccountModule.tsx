import { useState } from 'react';
import type { User } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/store/useAuth';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return '—';
  }
}

export function AccountModule(_props: ModuleProps) {
  const token = useAuth((s) => s.token);
  const storedUser = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const clear = useAuth((s) => s.clear);

  // Refresh the account (incl. admin flag) from the server on mount.
  const meFetch = useFetch((signal) => api.me(signal), [token], { enabled: Boolean(token) });
  const account: User | null = meFetch.data ?? storedUser;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [sessionMsg, setSessionMsg] = useState<Msg>(null);

  if (!token) {
    return <EmptyState>Sign in to manage your account.</EmptyState>;
  }

  const submitPassword = async () => {
    setPwMsg(null);
    if (next.length < 6) {
      setPwMsg({ kind: 'err', text: 'New password must be at least 6 characters.' });
      return;
    }
    if (next !== confirm) {
      setPwMsg({ kind: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    setBusy(true);
    try {
      const s = await api.changePassword(current, next);
      setSession(s.token, s.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      setPwMsg({ kind: 'ok', text: 'Password changed. Other devices have been signed out.' });
    } catch (e) {
      setPwMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not change password.' });
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = async () => {
    setSessionMsg(null);
    try {
      const s = await api.logoutAll();
      setSession(s.token, s.user);
      setSessionMsg({ kind: 'ok', text: 'Signed out of all other devices.' });
    } catch (e) {
      setSessionMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not rotate sessions.' });
    }
  };

  const msgClass = (m: Msg) => (m?.kind === 'ok' ? 'text-term-up' : 'text-term-down');
  const inputCls =
    'w-full rounded-sm border border-term-border bg-transparent px-2 py-1 text-xs text-term-text outline-none focus:border-term-amber';

  return (
    <div className="scroll-term h-full overflow-auto p-3 text-xs">
      {/* Account */}
      <section className="mb-4">
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-dim">Account</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-term-text">{account?.username ?? '—'}</span>
          {account?.isAdmin && (
            <span className="rounded-sm bg-term-amber/20 px-1.5 py-0.5 text-2xs uppercase text-term-amber">
              admin
            </span>
          )}
        </div>
        {account && <div className="mt-0.5 text-2xs text-term-muted">joined {fmtDate(account.createdAt)}</div>}
      </section>

      {/* Change password */}
      <section className="mb-4">
        <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-term-dim">
          Change password
        </h3>
        <div className="flex flex-col gap-1.5">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className={inputCls}
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password (min 6)"
            autoComplete="new-password"
            className={inputCls}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPassword();
            }}
            className={inputCls}
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => void submitPassword()}
              disabled={busy || !current || !next}
              className="rounded-sm border border-term-amber px-2 py-1 text-2xs text-term-amber hover:bg-term-amber/10 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
            {pwMsg && <span className={`text-2xs ${msgClass(pwMsg)}`}>{pwMsg.text}</span>}
          </div>
        </div>
      </section>

      {/* Sessions */}
      <section className="mb-4">
        <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-term-dim">Sessions</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void signOutOthers()}
            className="rounded-sm border border-term-border px-2 py-1 text-2xs text-term-muted hover:text-term-text"
          >
            Sign out other devices
          </button>
          <button
            onClick={() => clear()}
            className="rounded-sm border border-term-border px-2 py-1 text-2xs text-term-down hover:bg-term-down/10"
          >
            Log out
          </button>
          {sessionMsg && <span className={`text-2xs ${msgClass(sessionMsg)}`}>{sessionMsg.text}</span>}
        </div>
      </section>

      {/* Admin: users */}
      {account?.isAdmin && <AdminUsers selfId={account.id} />}
    </div>
  );
}

/** Admin-only user list with remove actions. */
function AdminUsers({ selfId }: { selfId: string }) {
  const { data, error, loading, refresh } = useFetch((signal) => api.listUsers(signal), []);
  const [msg, setMsg] = useState<Msg>(null);

  const remove = async (id: string) => {
    setMsg(null);
    try {
      await api.deleteUser(id);
      refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not remove user.' });
    }
  };

  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-term-dim">
        Users{data ? ` (${data.length})` : ''}
      </h3>
      {loading && !data && <Loading label="Loading users" />}
      {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
      {data && (
        <table className="w-full">
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-b border-term-border/30">
                <td className="py-1">
                  <span className="font-medium text-term-text">{u.username}</span>
                  {u.isAdmin && <span className="ml-1.5 text-2xs uppercase text-term-amber">admin</span>}
                </td>
                <td className="py-1 text-right text-2xs text-term-muted">{fmtDate(u.createdAt)}</td>
                <td className="py-1 pl-2 text-right">
                  {u.id !== selfId && (
                    <button
                      onClick={() => void remove(u.id)}
                      title={`Remove ${u.username}`}
                      className="text-2xs text-term-dim hover:text-term-down"
                    >
                      remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <div className={`mt-1 text-2xs ${msg.kind === 'ok' ? 'text-term-up' : 'text-term-down'}`}>{msg.text}</div>}
    </section>
  );
}
