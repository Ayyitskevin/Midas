import type { CommandDef } from '@/commands/registry';

/**
 * Unified screener catalog. Midas has ~115 indicator/analytics "board"
 * commands; rather than memorize codes, this groups them into a small set of
 * searchable categories. The board set and its grouping are derived from the
 * command registry itself (no hand-maintained list): a board is a no-symbol
 * command that describes itself as a "board", and each is bucketed by keywords
 * in its title/description. Pure and synchronous.
 */
export const BOARD_CATEGORIES = [
  'Momentum & Oscillators',
  'Trend & Moving Averages',
  'Volatility & Bands',
  'Volume & Flow',
  'Cycles (Ehlers)',
  'Risk & Performance',
  'Other',
] as const;
export type BoardCategory = (typeof BOARD_CATEGORIES)[number];

/** A board = a no-symbol command whose description calls itself a "board" (excludes this catalog itself). */
export function isBoard(cmd: CommandDef): boolean {
  return !cmd.requiresSymbol && cmd.module !== 'BOARDS' && /\bboard\b/i.test(cmd.description);
}

// First matching rule wins; ordered most-distinctive first so cross-cutting
// words (e.g. "oscillator" inside an Ehlers cycle indicator) land sensibly.
const RULES: { category: BoardCategory; re: RegExp }[] = [
  {
    category: 'Risk & Performance',
    re: /\b(ratio|sharpe|sortino|calmar|sterling|omega|drawdown|var|ulcer|beta|alpha|treynor|kelly|risk|pain|tail|martin|information|appraisal|modigliani|gain[- ]to[- ]pain|capture|efficiency|recovery|ruin|kurtosis|skew)\b/i,
  },
  {
    category: 'Cycles (Ehlers)',
    re: /\b(ehlers|cycle|sinewave|sine ?wave|roofing|cyber|center[- ]of[- ]gravity|fractal|hilbert|mama|fama)\b/i,
  },
  {
    category: 'Volume & Flow',
    re: /\b(volume|obv|accumulation|distribution|money flow|force index|ease of movement|klinger|chaikin|qstick|vwap|pvt|nvi|pvi|on[- ]balance|vigor)\b/i,
  },
  {
    category: 'Volatility & Bands',
    re: /\b(volatility|atr|bollinger|keltner|band|channel|squeeze|choppiness|mass index|range|cone|donchian|%b)\b/i,
  },
  {
    category: 'Trend & Moving Averages',
    re: /\b(trend|moving average|ema|sma|hull|kama|vidya|mcginley|alligator|supertrend|aroon|adx|dmi|vortex|ichimoku|parabolic|sar|gann|coral|tillson|t3|zero[- ]lag|zlema|kaufman|arnaud|alma|rainbow|disparity|inertia)\b/i,
  },
  {
    category: 'Momentum & Oscillators',
    re: /\b(momentum|oscillator|rsi|stochastic|macd|cci|williams|ultimate|trix|fisher|coppock|tsi|awesome|accelerator|relative strength|wave ?trend|smi|rmi|derivative|chande|demarker|td sequential|connors|know sure thing|projection|premier|roc)\b/i,
  },
];

export function classifyBoard(cmd: CommandDef): BoardCategory {
  const hay = `${cmd.title} ${cmd.description}`;
  for (const r of RULES) if (r.re.test(hay)) return r.category;
  return 'Other';
}

export interface BoardEntry {
  code: string;
  title: string;
  description: string;
  category: BoardCategory;
}
export interface BoardGroup {
  category: BoardCategory;
  boards: BoardEntry[];
}

/** Build the searchable, categorized board catalog (empty query = all boards). */
export function boardCatalog(commands: CommandDef[], query = ''): BoardGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (c: CommandDef) =>
    q === '' ||
    c.code.toLowerCase().includes(q) ||
    c.title.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    c.aliases.some((a) => a.toLowerCase().includes(q));

  const entries: BoardEntry[] = commands
    .filter(isBoard)
    .filter(matches)
    .map((c) => ({ code: c.code, title: c.title, description: c.description, category: classifyBoard(c) }));

  return BOARD_CATEGORIES.map((category) => ({
    category,
    boards: entries.filter((e) => e.category === category).sort((a, b) => a.code.localeCompare(b.code)),
  })).filter((g) => g.boards.length > 0);
}

/** Total number of boards in the registry (for the catalog header). */
export function boardCount(commands: CommandDef[]): number {
  return commands.filter(isBoard).length;
}

/** The board entries for a set of favorited codes (catalog order; non-boards ignored). */
export function pinnedBoards(commands: CommandDef[], codes: string[]): BoardEntry[] {
  const set = new Set(codes);
  return commands
    .filter(isBoard)
    .filter((c) => set.has(c.code))
    .map((c) => ({ code: c.code, title: c.title, description: c.description, category: classifyBoard(c) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
