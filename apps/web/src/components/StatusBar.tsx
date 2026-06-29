import { usePanels } from '@/store/usePanels';
import { useAuth } from '@/store/useAuth';
import { useHotkeyHelp } from '@/store/useHotkeyHelp';
import { stream, useStreamStatus } from '@/lib/stream';
import { streamStatusView } from '@/lib/streamStatus';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { sourceView } from '@/lib/sourceStatus';

export function StatusBar() {
  const panelCount = usePanels((s) => s.panels.length);
  const reset = usePanels((s) => s.resetWorkspace);
  const toggleHelp = useHotkeyHelp((s) => s.toggle);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.clear);
  const status = useStreamStatus();
  const conn = streamStatusView(status, stream.subscriberCount());
  const { data: health } = useFetch((signal) => api.health(signal), [], { intervalMs: 30000 });
  const src = health ? sourceView(health.provider, health.live) : null;

  return (
    <div className="flex items-center justify-between border-t border-term-border bg-term-header px-3 py-1 text-2xs text-term-muted">
      <div className="flex items-center gap-3">
        <span className="text-term-amber">MIDAS</span>
        <span className="text-term-dim">v0.1.0</span>
        <span>
          {panelCount} panel{panelCount === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1" title={conn.title}>
          <span className={conn.dotClass}>●</span>
          <span className="hidden sm:inline">{conn.label}</span>
        </span>
        {src && (
          <span className="flex items-center gap-1" title={src.title}>
            <span className={src.dotClass}>●</span>
            <span className="hidden sm:inline">
              {src.label}
              {src.tone === 'synthetic' && <span className="text-term-amber"> · synthetic</span>}
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">
          type a ticker then <span className="text-term-text">DES · GP · N</span> — or{' '}
          <span className="text-term-text">HELP</span>
        </span>
        <button
          onClick={toggleHelp}
          className="hidden transition-colors hover:text-term-text sm:inline"
          title="Keyboard shortcuts (press ?)"
        >
          ⌨ keys
        </button>
        <button onClick={reset} className="transition-colors hover:text-term-down" title="Close all panels">
          RESET
        </button>
        {user && (
          <span className="flex items-center gap-1.5">
            <span className="text-term-text">{user.username}</span>
            <button onClick={logout} className="transition-colors hover:text-term-down" title="Log out">
              logout
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
