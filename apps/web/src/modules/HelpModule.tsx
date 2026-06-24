import { COMMANDS } from '@/commands/registry';
import { openModule, openSymbol } from '@/commands/execute';
import type { ModuleProps } from './types';

export function HelpModule(_props: ModuleProps) {
  return (
    <div className="scroll-term h-full space-y-4 overflow-auto p-3 text-xs leading-relaxed">
      <section>
        <h3 className="term-label mb-1">Getting started</h3>
        <p className="text-term-muted">
          Type into the command bar at the top. The grammar mirrors a Bloomberg-style function line —
          a symbol followed by a function code:
        </p>
        <pre className="mt-2 whitespace-pre-wrap rounded-sm bg-term-header p-2 text-2xs text-term-text">
{`BTC/USDT          open description
BTC/USDT GP       price chart
BTC/USDT BOOK     live order book (DOM)
W                 your watchlist
HELP              this panel`}
        </pre>
      </section>

      <section>
        <h3 className="term-label mb-1">Commands</h3>
        <table className="w-full">
          <tbody>
            {COMMANDS.map((c) => (
              <tr key={c.code} className="border-b border-term-border/30 align-top">
                <td className="whitespace-nowrap py-1 pr-2 font-bold text-term-amber">{c.code}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-2xs text-term-dim">
                  {c.aliases.join(', ') || '—'}
                </td>
                <td className="py-1 text-term-muted">{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="term-label mb-1">Try it</h3>
        <div className="flex flex-wrap gap-1.5">
          {['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT'].map((s) => (
            <button
              key={s}
              onClick={() => openSymbol(s)}
              className="no-drag rounded-sm border border-term-border px-2 py-1 text-2xs hover:border-term-amber hover:text-term-amber"
            >
              {s} DES
            </button>
          ))}
          <button
            onClick={() => openModule('BOOK', 'BTC/USDT')}
            className="no-drag rounded-sm border border-term-border px-2 py-1 text-2xs hover:border-term-amber hover:text-term-amber"
          >
            BTC/USDT BOOK
          </button>
        </div>
      </section>

      <section>
        <h3 className="term-label mb-1">Tips</h3>
        <ul className="list-disc space-y-0.5 pl-4 text-term-muted">
          <li>Just start typing anywhere to focus the command bar.</li>
          <li>↑ / ↓ recall previous commands.</li>
          <li>Drag panel title bars to rearrange; drag a corner to resize.</li>
          <li>Your layout and watchlist are saved in this browser.</li>
        </ul>
      </section>
    </div>
  );
}
