import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { usePanels } from '@/store/usePanels';
import type { ModuleProps } from './types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Summarize this market',
  'What are the top movers?',
  'Explain the funding rate',
  'Is the order book bid- or ask-heavy?',
];

export function AiCopilotModule({ panel }: ModuleProps) {
  const activeSymbol = usePanels((s) => s.activeSymbol);
  const symbol = panel.symbol ?? activeSymbol ?? undefined;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const res = await api.aiChat(next, symbol);
      setMessages([...next, { role: 'assistant', content: res.content }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="scroll-term flex-1 space-y-2 overflow-auto p-2 text-xs">
        {messages.length === 0 && (
          <div className="text-2xs text-term-muted">
            <div className="mb-2">
              Ask about <span className="text-term-text">{symbol ?? 'the market'}</span> — answers are
              grounded in your terminal’s live data.
            </div>
            <div className="flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-sm border border-term-border px-1.5 py-0.5 hover:border-term-amber hover:text-term-amber"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="leading-snug">
            <span
              className={`mr-1 text-2xs font-bold ${
                m.role === 'user' ? 'text-term-accent' : 'text-term-amber'
              }`}
            >
              {m.role === 'user' ? 'YOU' : 'AI'}
            </span>
            <span className={`whitespace-pre-wrap ${m.role === 'user' ? 'text-term-text' : 'text-term-muted'}`}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="text-2xs text-term-muted">
            <span className="animate-pulse text-term-amber">▮</span> thinking…
          </div>
        )}
        {error && <div className="text-2xs text-term-down">⚠ {error}</div>}
      </div>
      <form
        className="no-drag flex border-t border-term-border"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${symbol ?? 'markets'}…`}
          className="flex-1 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-term-dim"
        />
        <button type="submit" className="px-3 text-term-amber disabled:opacity-40" disabled={loading}>
          ➤
        </button>
      </form>
    </div>
  );
}
