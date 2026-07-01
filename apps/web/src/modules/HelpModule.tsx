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
PORT              paper portfolio + live P&L
BTC/USDT ALERT    set a price / funding alert
HELP              this panel`}
        </pre>
      </section>

      <section>
        <h3 className="term-label mb-1">Account &amp; trading</h3>
        <p className="text-term-muted">
          Midas is <span className="text-term-text">non-custodial and read-only by default</span>. It scales up only
          as you opt in:
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-term-muted">
          <li>
            <span className="text-term-text">Demo</span> — no keys: <span className="text-term-amber">BAL</span>,{' '}
            <span className="text-term-amber">ORD</span>, <span className="text-term-amber">POSN</span> and{' '}
            <span className="text-term-amber">FILLS</span> show a clearly-labeled synthetic account.
          </li>
          <li>
            <span className="text-term-text">Read-only</span> — set read-only exchange API keys on the server and the
            same panels show your real balances, orders, positions and fills. Nothing can be placed.
          </li>
          <li>
            <span className="text-term-text">Live</span> — explicitly enable trading on the server (master switch +
            caps + auth; see SECURITY.md) and <span className="text-term-amber">TICKET</span> places real orders
            behind a two-step confirm, with per-order and daily notional caps enforced server-side.{' '}
            <span className="text-term-amber">ORD</span> gains per-order cancel. A red{' '}
            <span className="text-term-down">● LIVE TRADING</span> badge shows in the status bar whenever this is on.
          </li>
        </ul>
        <p className="mt-1 text-term-muted">
          Try the <span className="text-term-text">Trade Desk</span> workspace template (+ tab → Trade Desk): chart,
          book and ticket linked — clicking a book level sends that price to the ticket.
        </p>
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
          <li>
            Click a panel’s colored dot to join a <span className="text-term-text">link group</span>{' '}
            — linked panels share a symbol, so a linked watchlist drives them all.
          </li>
          <li>
            Use the <span className="text-term-text">workspace tabs</span> to keep separate layouts.{' '}
            <span className="text-term-amber">+</span> opens a blank workspace, a ready-made template,
            or imports a <span className="text-term-text">.midas.json</span> file;{' '}
            <span className="text-term-amber">⤓</span> exports the current one.
          </li>
          <li>
            On a price chart, toggle <span className="text-term-amber">⚑ alert</span> and click a
            level to arm a price alert there — armed alerts show as lines on the chart.
          </li>
          <li>Your layout and watchlist are saved in this browser.</li>
        </ul>
      </section>
    </div>
  );
}
