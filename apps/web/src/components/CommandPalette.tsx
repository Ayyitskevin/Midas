import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResult } from '@midas/shared';
import { api } from '@/lib/api';
import { COMMANDS } from '@/commands/registry';
import { openSymbol, runCommand } from '@/commands/execute';
import { usePanels } from '@/store/usePanels';
import { rankByFuzzy } from '@/lib/fuzzy';

interface Item {
  kind: 'command' | 'symbol';
  primary: string;
  secondary: string;
  hint?: string;
  run: () => void;
}

const CMD_KEYS = (c: (typeof COMMANDS)[number]) => [c.code, ...c.aliases, c.title];

/**
 * A Cmd-K / Ctrl-K launcher: fuzzy-jump to any command or symbol from the
 * keyboard. Browsable (lists all commands) before typing; runs commands through
 * the same path as the command bar. Renders nothing while closed.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSymbol = usePanels((s) => s.activeSymbol);

  // Global Cmd/Ctrl-K toggles the palette; Esc closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset and focus when it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setResults([]);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced security search on the query.
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 1) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(term, controller.signal)
        .then((r) => !controller.signal.aborted && setResults(r))
        .catch(() => {});
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const ranked = rankByFuzzy(q, COMMANDS, CMD_KEYS);
    const cmdItems: Item[] = ranked.slice(0, q ? 8 : ranked.length).map((c) => ({
      kind: 'command',
      primary: c.code,
      secondary: c.title,
      hint: c.requiresSymbol ? (activeSymbol ?? 'needs symbol') : undefined,
      run: () => runCommand(c.requiresSymbol ? `${activeSymbol ?? ''} ${c.code}`.trim() : c.code),
    }));
    const symItems: Item[] = results.slice(0, 6).map((s) => ({
      kind: 'symbol',
      primary: s.symbol,
      secondary: s.name,
      run: () => openSymbol(s.symbol),
    }));
    return [...cmdItems, ...symItems];
  }, [query, results, activeSymbol]);

  // Keep the highlighted row within range as the list changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const run = (item: Item) => {
    item.run();
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-md border border-term-border bg-term-panel shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const it = items[active];
              if (it) run(it);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          placeholder="Jump to a command or symbol…"
          className="w-full border-b border-term-border bg-transparent px-3 py-2.5 text-sm text-term-text outline-none placeholder:text-term-dim"
        />
        <ul className="scroll-term max-h-80 overflow-auto">
          {items.length === 0 && <li className="px-3 py-3 text-xs text-term-dim">No matches.</li>}
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.primary}-${i}`}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(it);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${
                  i === active ? 'bg-term-header' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`w-12 shrink-0 text-2xs uppercase ${
                      it.kind === 'symbol' ? 'text-term-accent' : 'text-term-amber'
                    }`}
                  >
                    {it.kind}
                  </span>
                  <span className="font-medium text-term-text">{it.primary}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {it.hint && <span className="text-2xs text-term-dim">{it.hint}</span>}
                  <span className="truncate text-2xs text-term-muted">{it.secondary}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-term-border px-3 py-1 text-2xs text-term-dim">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span>⌘K / Ctrl-K</span>
        </div>
      </div>
    </div>
  );
}
