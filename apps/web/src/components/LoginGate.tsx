import { useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/store/useAuth';

function Splash({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-term-bg text-xs text-term-muted">
      <span className="animate-pulse text-term-amber">▮</span>
      <span className="ml-2">{label}…</span>
    </div>
  );
}

const fieldCls =
  'w-full rounded-sm border border-term-border bg-term-bg px-2 py-1.5 text-sm text-term-text outline-none focus:border-term-amber';

function LoginForm({
  allowSignup,
  onSession,
}: {
  allowSignup: boolean;
  onSession: (token: string, user: User) => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === 'signup'
          ? await api.signup(username.trim(), password)
          : await api.login(username.trim(), password);
      onSession(session.token, session.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-term-bg p-4">
      <form onSubmit={submit} className="w-72 rounded-sm border border-term-border bg-term-panel p-4">
        <div className="mb-3 text-center">
          <div className="text-lg font-bold tracking-[0.2em] text-term-amber">MIDAS</div>
          <div className="text-2xs text-term-dim">{mode === 'signup' ? 'create an account' : 'sign in'}</div>
        </div>
        <div className="space-y-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            autoFocus
            autoComplete="username"
            className={fieldCls}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className={fieldCls}
          />
        </div>
        {error && <div className="mt-2 text-2xs text-term-down">⚠ {error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded-sm border border-term-amber px-3 py-1.5 text-xs font-semibold text-term-amber hover:bg-term-amber hover:text-term-bg disabled:opacity-50"
        >
          {busy ? '…' : mode === 'signup' ? 'Sign up' : 'Log in'}
        </button>
        {allowSignup && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError(null);
            }}
            className="mt-2 w-full text-center text-2xs text-term-muted hover:text-term-text"
          >
            {mode === 'signup' ? 'have an account? log in' : 'need an account? sign up'}
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Gates the app behind a login screen when the server has auth enabled.
 * When auth is off (the default) it renders the app straight through.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const setSession = useAuth((s) => s.setSession);

  const statusQ = useFetch((signal) => api.authStatus(signal), [], {});
  const enabled = statusQ.data?.enabled ?? false;
  const meQ = useFetch((signal) => api.me(signal), [token], { enabled: enabled && Boolean(token) });

  if (!statusQ.data) {
    if (statusQ.error) {
      return (
        <div className="flex h-full items-center justify-center bg-term-bg px-6 text-center text-xs text-term-down">
          ⚠ Can’t reach the server — {statusQ.error}
        </div>
      );
    }
    return <Splash label="Connecting" />;
  }

  if (!enabled) return <>{children}</>;
  if (!token) return <LoginForm allowSignup={statusQ.data.allowSignup} onSession={setSession} />;
  if (meQ.data) return <>{children}</>;
  if (meQ.error) return <LoginForm allowSignup={statusQ.data.allowSignup} onSession={setSession} />;
  return <Splash label="Signing in" />;
}
