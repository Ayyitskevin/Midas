import { useEffect, useState } from 'react';
import { useNotes, GLOBAL_KEY } from '@/store/useNotes';
import type { ModuleProps } from './types';

/** Short relative time since `ms` (e.g. "just now", "5m ago", "2h ago"). */
function since(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function NotesModule({ panel }: ModuleProps) {
  const notes = useNotes((s) => s.notes);
  const setNote = useNotes((s) => s.setNote);

  const [scope, setScope] = useState<string>(() => panel.symbol?.toUpperCase() ?? GLOBAL_KEY);

  // A linked notes panel follows whatever symbol is being navigated.
  useEffect(() => {
    if (panel.symbol) setScope(panel.symbol.toUpperCase());
  }, [panel.symbol]);

  const entry = notes[scope];
  const text = entry?.text ?? '';

  // Scope chips: Global, the panel's symbol, then any other noted symbols.
  const chips: Array<{ key: string; label: string }> = [{ key: GLOBAL_KEY, label: 'Global' }];
  if (panel.symbol) chips.push({ key: panel.symbol.toUpperCase(), label: panel.symbol.toUpperCase() });
  for (const k of Object.keys(notes)) {
    if (k === GLOBAL_KEY || chips.some((c) => c.key === k)) continue;
    chips.push({ key: k, label: k });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="no-drag flex flex-wrap items-center gap-1 border-b border-term-border px-2 py-1 text-2xs">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setScope(c.key)}
            className={`rounded-sm px-1.5 py-0.5 ${
              scope === c.key ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setNote(scope, e.target.value)}
        spellCheck={false}
        placeholder={
          scope === GLOBAL_KEY
            ? 'Market notes — thesis, levels, reminders…'
            : `Notes on ${scope}…`
        }
        className="scroll-term min-h-0 flex-1 resize-none bg-transparent p-2 text-xs leading-relaxed text-term-text outline-none placeholder:text-term-dim"
      />

      <div className="flex items-center justify-between border-t border-term-border px-2 py-0.5 text-2xs text-term-dim">
        <span>{scope === GLOBAL_KEY ? 'Global note' : scope}</span>
        <span>{entry ? `saved · ${since(entry.updatedAt)}` : 'empty'}</span>
      </div>
    </div>
  );
}
