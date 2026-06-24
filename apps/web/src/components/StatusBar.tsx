import { usePanels } from '@/store/usePanels';
import { useStreamStatus } from '@/lib/stream';

export function StatusBar() {
  const panelCount = usePanels((s) => s.panels.length);
  const reset = usePanels((s) => s.resetWorkspace);
  const streamStatus = useStreamStatus();

  return (
    <div className="flex items-center justify-between border-t border-term-border bg-term-header px-3 py-1 text-2xs text-term-muted">
      <div className="flex items-center gap-3">
        <span className="text-term-amber">MIDAS</span>
        <span className="text-term-dim">v0.1.0</span>
        <span>
          {panelCount} panel{panelCount === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1" title={`stream ${streamStatus}`}>
          <span
            className={
              streamStatus === 'open'
                ? 'text-term-up'
                : streamStatus === 'connecting'
                  ? 'text-term-amber'
                  : 'text-term-dim'
            }
          >
            ●
          </span>
          <span className="hidden sm:inline">
            {streamStatus === 'open' ? 'LIVE' : streamStatus === 'connecting' ? '…' : 'idle'}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">
          type a ticker then <span className="text-term-text">DES · GP · N</span> — or{' '}
          <span className="text-term-text">HELP</span>
        </span>
        <button onClick={reset} className="transition-colors hover:text-term-down" title="Close all panels">
          RESET
        </button>
      </div>
    </div>
  );
}
