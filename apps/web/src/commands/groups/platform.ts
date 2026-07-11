import type { CommandDef } from '../registry';

/** Platform surfaces: AI copilot, workspaces, the read-only account panels, SYS/KEYS, onboarding, the order ticket. */
export const PLATFORM_COMMANDS: CommandDef[] = [
  {
    code: 'AI',
    aliases: ['ASK', 'COPILOT'],
    title: 'AI Copilot',
    module: 'AI',
    requiresSymbol: false,
    description: 'Ask Claude about the market — grounded in your terminal’s live data.',
  },
  {
    code: 'W',
    aliases: ['WATCH', 'WL'],
    title: 'Watchlist',
    module: 'W',
    requiresSymbol: false,
    description: 'Your personal watchlist of securities.',
  },
  {
    code: 'Q',
    aliases: ['QM', 'QUOTE'],
    title: 'Quote Monitor',
    module: 'Q',
    requiresSymbol: false,
    description: 'Live quote grid for your watchlist symbols.',
  },
  {
    code: 'PORT',
    aliases: ['POS', 'PORTFOLIO'],
    title: 'Portfolio',
    module: 'PORT',
    requiresSymbol: false,
    description: 'Paper portfolio — track positions and live unrealized P&L.',
  },
  {
    code: 'BAL',
    aliases: ['BALANCE', 'BALANCES', 'ACCTBAL'],
    title: 'Balances',
    module: 'BAL',
    requiresSymbol: false,
    description:
      'Read-only exchange account balances — per-asset free / used / total, USD value and allocation %, with a total and a live/demo data-honesty badge. Non-custodial: balances are read with read-only API keys supplied via the server environment (MIDAS_CCXT_API_KEY / MIDAS_CCXT_SECRET on the ccxt provider); Midas never places orders or holds funds. Shows a synthetic demo book until keys are configured.',
  },
  {
    code: 'ORD',
    aliases: ['ORDERS', 'OPENORDERS', 'OO'],
    title: 'Open Orders',
    module: 'ORD',
    requiresSymbol: false,
    description:
      'Read-only open (resting) orders on your exchange account — symbol, side, type, price, amount, filled % and quote value, with a live/demo data-honesty badge. Non-custodial: read with read-only API keys from the server environment (ccxt provider); Midas only ever reads (fetchOpenOrders) — it never places or cancels orders. Shows a synthetic demo set until keys are configured.',
  },
  {
    code: 'POSN',
    aliases: ['POSITIONS', 'LIVEPOS', 'XPOS'],
    title: 'Positions',
    module: 'POSN',
    requiresSymbol: false,
    description:
      'Read-only open derivatives positions on your exchange account — side, size, entry, mark, unrealized P&L (and %), liquidation price and leverage, with a total uPnL and a live/demo data-honesty badge. Non-custodial: read with read-only API keys from the server environment (ccxt provider); Midas only ever reads (fetchPositions) — it never opens or closes positions. Shows a synthetic demo set until keys are configured.',
  },
  {
    code: 'FILLS',
    aliases: ['MYTRADES', 'FILLHIST', 'EXECUTIONS'],
    title: 'Fills',
    module: 'FILLS',
    requiresSymbol: false,
    description:
      'Your own executions (my-trades) — time, symbol, side, price, amount, cost, fee and maker/taker for recent fills on the connected account, with a live/demo data-honesty badge. Symbol-aware: some exchanges (e.g. Binance) only serve fills per symbol, so open it as BTC/USDT FILLS there; account-wide where the venue supports it. Read-only and non-custodial; synthetic demo fills until read-only keys are configured.',
  },
  {
    code: 'SYS',
    aliases: ['STATUS', 'SYSTEM'],
    title: 'System Status',
    module: 'SYS',
    requiresSymbol: false,
    description:
      "The server's operational self-description — provider and live flag, version, uptime, and which background loops are actually running (account watcher, ccxt.pro stream nudge, operator digest, equity snapshots, live-trading gate, auth). The honest answer to \"is it on?\" without reading server logs.",
  },
  {
    code: 'KEYS',
    aliases: ['APIKEYS', 'EXKEYS'],
    title: 'Exchange Keys',
    module: 'KEYS',
    requiresSymbol: false,
    description:
      'Manage your own exchange API keys on a shared/hosted Midas — save (write-only: encrypted at rest server-side, never displayed again), inspect the metadata (exchange + last 4), delete in one action. With keys stored, BAL/ORD/POSN/FILLS read YOUR account. Execution remains under a server safety hold regardless of canTrade metadata. Needs login; the operator enables the store with MIDAS_KEYS_KMS_SECRET. Use read-only keys and never enable withdrawal permission.',
  },
  {
    code: 'START',
    aliases: ['TOUR', 'GETSTART', 'INTRO'],
    title: 'Get Started',
    module: 'START',
    requiresSymbol: false,
    description:
      'The first-run tour — six one-click rows that each run a real command (chart, book, screener, alert, account, what\'s new), teaching the SYMBOL FUNCTION grammar by doing. Opens automatically on the very first visit; run START any time to bring it back.',
  },
  {
    code: 'XQL',
    aliases: ['EXECQ', 'TCA'],
    title: 'Execution Quality',
    module: 'XQL',
    requiresSymbol: false,
    description:
      'Execution quality from your own fills — maker/taker mix, fee totals by currency, total notional, and realized slippage vs the estimates the order ticket recorded at placement (notional-weighted, with an honest coverage % since fills placed outside this browser have no baseline). Per-symbol breakdown; symbol-aware for venues that only serve fills per symbol (BTC/USDT XQL). Read-only.',
  },
  {
    code: 'AEQ',
    aliases: ['ACCTEQ', 'ACCTCURVE'],
    title: 'Account Equity',
    module: 'AEQ',
    requiresSymbol: false,
    description:
      "Your real account's equity curve — periodic server-side snapshots of total account value (and unrealized P&L) from read-only balance/position reads, charted over time. Snapshots accrue with no browser open (MIDAS_EQUITY_SNAP_MS, default hourly) and persist across restarts; outages appear as honest gaps in time, never interpolated points. Non-custodial: reads only.",
  },
  {
    code: 'WN',
    aliases: ['WHATSNEW', 'CHANGELOG', 'RELEASES'],
    title: "What's New",
    module: 'WN',
    requiresSymbol: false,
    description:
      "Release highlights, in-terminal — what changed in each Midas version, newest first, with a link to the full CHANGELOG. Pairs with the one-time update toast: when your server moves to a new version, the terminal tells you once and points here.",
  },
  {
    code: 'TICKET',
    aliases: ['ORDER', 'OE', 'PREVIEW'],
    title: 'Order Ticket',
    module: 'TICKET',
    requiresSymbol: true,
    description:
      'Order ticket — build and validate a market/limit order and preview it against the live L2 book: average fill, fee, slippage vs the touch, whether a limit takes now or rests, total cost / net proceeds, and a book-exhausted warning. Preview only: the server execution safety hold rejects placement and in-app cancellation regardless of environment flags or key metadata.',
  },
];
