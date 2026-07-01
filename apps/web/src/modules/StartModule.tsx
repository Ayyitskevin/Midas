import { runCommand } from '@/commands/execute';
import { TOUR_STEPS } from '@/lib/tourSteps';

/**
 * START — the first-run tour. Six one-click rows that each RUN a real
 * command, teaching the grammar by doing: the fastest path from "empty
 * terminal" to "I get it". Opens automatically on the very first visit.
 */
export function StartModule() {
  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-3">
      <p className="text-2xs leading-relaxed text-term-muted">
        Welcome to <span className="font-semibold text-term-amber">Midas</span>. Everything is a command —
        click a row to run it, then try typing it yourself.
      </p>
      <div className="space-y-1.5">
        {TOUR_STEPS.map((s, i) => (
          <button
            key={s.command}
            type="button"
            onClick={() => runCommand(s.command)}
            className="block w-full rounded-sm border border-term-border bg-term-panel/50 px-2 py-1.5 text-left hover:border-term-amber/50"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-2xs text-term-dim">{i + 1}</span>
              <span className="font-mono text-xs text-term-amber">{s.command}</span>
              <span className="ml-auto text-2xs font-semibold uppercase tracking-wide text-term-text">{s.title}</span>
            </div>
            <div className="mt-0.5 pl-4 text-2xs leading-relaxed text-term-muted">{s.blurb}</div>
          </button>
        ))}
      </div>
      <p className="mt-auto px-1 text-2xs leading-relaxed text-term-dim">
        Pro moves: <span className="text-term-text">⌘K / Ctrl-K</span> searches every command · the{' '}
        <span className="text-term-text">+ tab → Trade Desk</span> template builds a linked chart/book/ticket
        workspace · <span className="font-mono text-term-amber">HELP</span> lists everything. Close this panel
        whenever — <span className="font-mono text-term-amber">START</span> brings it back.
      </p>
    </div>
  );
}
