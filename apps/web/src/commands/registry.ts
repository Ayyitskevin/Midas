import type { ModuleCode } from '@/modules/meta';
import type { PanelParams } from '@/store/usePanels';

/** A terminal command (Bloomberg-style mnemonic) the user can type. */
export interface CommandDef {
  code: string;
  aliases: string[];
  title: string;
  /** Which module/panel this command opens. */
  module: ModuleCode;
  /** If true, the command operates on a security and needs a symbol. */
  requiresSymbol: boolean;
  description: string;
  /** Default params handed to the module (e.g. chart interval/range). */
  params?: PanelParams;
}

export const COMMANDS: CommandDef[] = [
  {
    code: 'DES',
    aliases: ['DESC', 'DS'],
    title: 'Security Description',
    module: 'DES',
    requiresSymbol: true,
    description: 'Snapshot quote, key stats and session detail for a security.',
  },
  {
    code: 'GP',
    aliases: ['CHART', 'G', 'GRAPH'],
    title: 'Price Graph',
    module: 'GP',
    requiresSymbol: true,
    description: 'Historical price chart (daily candles).',
    params: { interval: '1d', range: '6mo' },
  },
  {
    code: 'GIP',
    aliases: ['INTRADAY'],
    title: 'Intraday Graph',
    module: 'GP',
    requiresSymbol: true,
    description: 'Intraday price chart (5-minute candles).',
    params: { interval: '5m', range: '1d' },
  },
  {
    code: 'COMP',
    aliases: ['COMPARE', 'CMP', 'REL'],
    title: 'Compare',
    module: 'COMP',
    requiresSymbol: false,
    description: 'Overlay several symbols rebased to % change to compare performance.',
    params: { interval: '1d', range: '6mo' },
  },
  {
    code: 'RATIO',
    aliases: ['SPREAD', 'PAIR'],
    title: 'Ratio / Spread',
    module: 'RATIO',
    requiresSymbol: false,
    description: 'Chart the ratio (A/B) or spread (A−B) between two symbols over time.',
    params: { interval: '1d', range: '6mo' },
  },
  {
    code: 'BOOK',
    aliases: ['DOM', 'OB'],
    title: 'Order Book',
    module: 'BOOK',
    requiresSymbol: true,
    description: 'Live Level-2 order book / depth of market (best on crypto).',
  },
  {
    code: 'TAS',
    aliases: ['PRINTS', 'TS', 'TRADES'],
    title: 'Time & Sales',
    module: 'TAS',
    requiresSymbol: true,
    description: 'Live streaming trade prints (time & sales).',
  },
  {
    code: 'ALLQ',
    aliases: ['XQ', 'VENUES'],
    title: 'Multi-Exchange Quotes',
    module: 'ALLQ',
    requiresSymbol: true,
    description: 'Compare a pair across exchanges — best bid/ask and cross-exchange spread.',
  },
  {
    code: 'FUND',
    aliases: ['OI', 'LIQ', 'PERP'],
    title: 'Derivatives',
    module: 'FUND',
    requiresSymbol: true,
    description: 'Perp funding rate, open interest and recent liquidations.',
  },
  {
    code: 'FUNDR',
    aliases: ['RATES', 'CARRY'],
    title: 'Funding Rates',
    module: 'FUNDR',
    requiresSymbol: false,
    description: 'Funding rates & open interest across the top perps — sortable board.',
  },
  {
    code: 'LIQS',
    aliases: ['LIQUIDATIONS', 'REKT'],
    title: 'Liquidations',
    module: 'LIQS',
    requiresSymbol: false,
    description: 'Market-wide liquidations feed across the top perps.',
  },
  {
    code: 'SCR',
    aliases: ['EQS', 'SCREEN', 'MOVERS'],
    title: 'Screener',
    module: 'SCR',
    requiresSymbol: false,
    description: 'Screen crypto markets by volume, 24h change or price.',
  },
  {
    code: 'HEAT',
    aliases: ['MAP', 'HM'],
    title: 'Market Heatmap',
    module: 'HEAT',
    requiresSymbol: false,
    description: 'Treemap of the market — tiles sized by volume, colored by 24h change.',
  },
  {
    code: 'MOV',
    aliases: ['OVERVIEW', 'BREADTH'],
    title: 'Market Overview',
    module: 'MOV',
    requiresSymbol: false,
    description: 'Market dashboard — top gainers, losers, most active and breadth.',
  },
  {
    code: 'CORR',
    aliases: ['COR', 'CORREL'],
    title: 'Correlation Matrix',
    module: 'CORR',
    requiresSymbol: false,
    description: 'Return-correlation grid across your watchlist symbols.',
  },
  {
    code: 'CAL',
    aliases: ['CALENDAR', 'EVENTS', 'ECON'],
    title: 'Market Calendar',
    module: 'CAL',
    requiresSymbol: false,
    description: 'Upcoming market timing — funding settlements, options/futures expiries and candle closes.',
  },
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
    code: 'ALERT',
    aliases: ['ALERTS', 'ALRT', 'AL'],
    title: 'Alerts',
    module: 'ALERT',
    requiresSymbol: false,
    description: 'Price & funding alerts — fire a toast / notification when a threshold is crossed.',
  },
  {
    code: 'N',
    aliases: ['NEWS', 'CN'],
    title: 'News',
    module: 'N',
    requiresSymbol: false,
    description: 'Headlines for a security, or top market news when no symbol is given.',
  },
  {
    code: 'TOP',
    aliases: ['MKT'],
    title: 'Top News',
    module: 'N',
    requiresSymbol: false,
    description: 'Top market-wide news headlines.',
  },
  {
    code: 'NOTE',
    aliases: ['NOTES', 'JRNL', 'MEMO'],
    title: 'Notes',
    module: 'NOTE',
    requiresSymbol: false,
    description: 'Free-form notes — global or per symbol, synced to your account.',
  },
  {
    code: 'RISK',
    aliases: ['SIZER', 'SIZE', 'POSITION'],
    title: 'Position Sizer',
    module: 'RISK',
    requiresSymbol: false,
    description: 'Risk-based position sizer — solve size from account, risk %, entry and stop.',
  },
  {
    code: 'DCA',
    aliases: ['AVG', 'AVERAGE', 'BASIS'],
    title: 'DCA / Averaging',
    module: 'DCA',
    requiresSymbol: false,
    description: 'Average-cost calculator — blend fills into an average entry, P&L and a target-average solver.',
  },
  {
    code: 'LOG',
    aliases: ['JOURNAL', 'TJ', 'TRADELOG'],
    title: 'Trade Journal',
    module: 'LOG',
    requiresSymbol: false,
    description: 'Trade journal — log entries/exits, score R-multiples, and track win rate, expectancy and total R.',
  },
  {
    code: 'PNL',
    aliases: ['FEE', 'FEES', 'ROE'],
    title: 'P&L Calculator',
    module: 'PNL',
    requiresSymbol: false,
    description: 'Trade P&L & fee calculator — gross/net P&L, ROE, fees paid and fee-inclusive break-even.',
  },
  {
    code: 'ACCT',
    aliases: ['ACCOUNT'],
    title: 'Account',
    module: 'ACCT',
    requiresSymbol: false,
    description: 'Manage your account — change password, sessions, and (admin) users.',
  },
  {
    code: 'PREF',
    aliases: ['SETTINGS', 'SET', 'PREFS', 'CONFIG'],
    title: 'Preferences',
    module: 'PREF',
    requiresSymbol: false,
    description: 'Terminal preferences — display density, ticker, default chart timeframe, alert delivery.',
  },
  {
    code: 'REPORT',
    aliases: ['EXPORT', 'CSV', 'REPORTS'],
    title: 'Reports / Export',
    module: 'REPORT',
    requiresSymbol: false,
    description: 'Export your data to CSV — journal, transactions, positions, alert triggers and watchlists.',
  },
  {
    code: 'SECF',
    aliases: ['FIND', 'SEARCH', 'SRCH'],
    title: 'Security Finder',
    module: 'SECF',
    requiresSymbol: false,
    description: 'Search for securities by ticker or name.',
  },
  {
    code: 'HELP',
    aliases: ['H', '?'],
    title: 'Help',
    module: 'HELP',
    requiresSymbol: false,
    description: 'List of available commands and how to use the terminal.',
  },
];

const BY_CODE = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  BY_CODE.set(cmd.code, cmd);
  for (const alias of cmd.aliases) BY_CODE.set(alias, cmd);
}

export function lookupCommand(token: string): CommandDef | undefined {
  return BY_CODE.get(token.trim().toUpperCase());
}

/** All distinct command codes (for autocomplete), excluding aliases. */
export const COMMAND_CODES = COMMANDS.map((c) => c.code);
