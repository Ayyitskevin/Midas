import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { CommandBar } from './CommandBar';
import { Clock } from './Clock';

export function TopBar() {
  const { data: health } = useFetch((signal) => api.health(signal), [], { intervalMs: 30_000 });

  return (
    <header className="flex items-center gap-4 border-b border-term-border bg-term-header px-3 py-1.5">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-base font-bold tracking-widest text-term-amber">MIDAS</span>
        <span className="hidden text-2xs uppercase tracking-wider text-term-dim sm:inline">
          terminal
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <CommandBar />
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs">
        {health && (
          <span className="flex items-center gap-1" title={health.live ? 'Live data source' : 'Synthetic data source'}>
            <span className={health.live ? 'text-term-up' : 'text-term-amber'}>
              {health.live ? '●' : '◌'}
            </span>
            <span className="hidden uppercase text-term-muted sm:inline">{health.provider}</span>
          </span>
        )}
        <Clock />
      </div>
    </header>
  );
}
