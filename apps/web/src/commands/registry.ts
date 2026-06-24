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
    code: 'SCR',
    aliases: ['EQS', 'SCREEN', 'MOVERS'],
    title: 'Screener',
    module: 'SCR',
    requiresSymbol: false,
    description: 'Screen crypto markets by volume, 24h change or price.',
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
