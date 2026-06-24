import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResult } from '@midas/shared';
import { api } from '@/lib/api';
import { COMMANDS } from '@/commands/registry';
import { openCommand, openSymbol, runCommand } from '@/commands/execute';
import { usePanels } from '@/store/usePanels';

interface Suggestion {
  kind: 'command' | 'symbol';
  primary: string;
  secondary: string;
  run: () => void;
}

export function CommandBar() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const histPos = useRef(-1);

  const activeSymbol = usePanels((s) => s.activeSymbol);

  // Start typing anywhere → focus the command bar and capture the keystroke.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typingElsewhere =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (typingElsewhere || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 && e.key !== ' ') {
        e.preventDefault();
        inputRef.current?.focus();
        setValue((v) => v + e.key);
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced security search on the first token.
  useEffect(() => {
    const term = value.trim().split(/\s+/)[0] ?? '';
    if (term.length < 1) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(term, controller.signal)
        .then((r) => !controller.signal.aborted && setSearchResults(r))
        .catch(() => {});
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const raw = value.trim();
    if (!raw) return [];
    const tokens = raw.toUpperCase().split(/\s+/);
    const list: Suggestion[] = [];

    if (tokens.length >= 2) {
      // "<symbol> <partial-command>" → suggest matching commands.
      const symbol = tokens[0];
      const partial = tokens[tokens.length - 1];
      for (const c of COMMANDS) {
        if (c.code.startsWith(partial) || c.aliases.some((a) => a.startsWith(partial))) {
          const usesSymbol = c.requiresSymbol || c.code === 'N';
          list.push({
            kind: 'command',
            primary: `${symbol} ${c.code}`,
            secondary: c.title,
            run: () => openCommand(c, usesSymbol ? symbol : null),
          });
        }
      }
    } else {
      const partial = tokens[0];
      for (const c of COMMANDS) {
        if (c.code.startsWith(partial) || c.aliases.some((a) => a.startsWith(partial))) {
          list.push({
            kind: 'command',
            primary: c.code,
            secondary: c.title,
            run: () => {
              const input = c.requiresSymbol ? `${activeSymbol ?? ''} ${c.code}`.trim() : c.code;
              const r = runCommand(input);
              if (!r.ok) setError(r.error ?? 'Unknown command');
            },
          });
        }
      }
      for (const s of searchResults.slice(0, 6)) {
        list.push({
          kind: 'symbol',
          primary: s.symbol,
          secondary: s.name,
          run: () => openSymbol(s.symbol),
        });
      }
    }
    return list.slice(0, 8);
  }, [value, searchResults, activeSymbol]);

  function pushHistory(v: string) {
    const h = historyRef.current;
    if (h[h.length - 1] !== v) h.push(v);
    if (h.length > 50) h.shift();
  }

  function postSuccess() {
    if (value.trim()) pushHistory(value.trim());
    setValue('');
    setOpen(false);
    setActive(-1);
    setError(null);
    histPos.current = -1;
  }

  function runSuggestion(s: Suggestion) {
    s.run();
    postSuccess();
  }

  function submitRaw() {
    const r = runCommand(value);
    if (!r.ok) {
      setError(r.error ?? 'Unknown command');
      return;
    }
    postSuccess();
  }

  function historyPrev() {
    const h = historyRef.current;
    if (!h.length) return;
    histPos.current = histPos.current < 0 ? h.length - 1 : Math.max(0, histPos.current - 1);
    setValue(h[histPos.current]);
  }

  function historyNext() {
    const h = historyRef.current;
    if (histPos.current < 0) return;
    if (histPos.current >= h.length - 1) {
      histPos.current = -1;
      setValue('');
    } else {
      histPos.current += 1;
      setValue(h[histPos.current]);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const hasSuggestions = open && suggestions.length > 0;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (hasSuggestions && active >= 0 && active < suggestions.length) {
          runSuggestion(suggestions[active]);
        } else {
          submitRaw();
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (hasSuggestions) {
          setActive((a) => Math.min(a + 1, suggestions.length - 1));
        } else {
          historyNext();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (hasSuggestions) {
          setActive((a) => Math.max(a - 1, 0));
        } else {
          historyPrev();
        }
        break;
      case 'Tab':
        if (hasSuggestions) {
          e.preventDefault();
          const pick = suggestions[active >= 0 ? active : 0];
          setValue(`${pick.primary} `);
          setActive(-1);
        }
        break;
      case 'Escape':
        if (open) {
          setOpen(false);
          setActive(-1);
        } else if (value) {
          setValue('');
        } else {
          inputRef.current?.blur();
        }
        break;
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-sm border border-term-border bg-term-bg px-2 py-1 focus-within:border-term-amber">
        <span className="text-term-amber">▸</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
            setError(null);
            histPos.current = -1;
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          spellCheck={false}
          autoComplete="off"
          placeholder="Enter command — e.g.  AAPL DES   ·   NVDA GP   ·   HELP"
          className="w-full bg-transparent text-sm uppercase text-term-text outline-none placeholder:normal-case placeholder:text-term-dim"
        />
        {error && <span className="shrink-0 text-2xs text-term-down">{error}</span>}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-sm border border-term-border bg-term-panel shadow-xl shadow-black/40 scroll-term">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.primary}`}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  runSuggestion(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${
                  i === active ? 'bg-term-header' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-10 shrink-0 text-2xs uppercase ${
                      s.kind === 'symbol' ? 'text-term-accent' : 'text-term-amber'
                    }`}
                  >
                    {s.kind}
                  </span>
                  <span className="font-medium text-term-text">{s.primary}</span>
                </span>
                <span className="truncate text-2xs text-term-muted">{s.secondary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
