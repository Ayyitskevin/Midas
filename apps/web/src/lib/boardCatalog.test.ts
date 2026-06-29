import { describe, it, expect } from 'vitest';
import { isBoard, classifyBoard, boardCatalog, boardCount } from './boardCatalog';
import type { CommandDef } from '@/commands/registry';
import { COMMANDS } from '@/commands/registry';

const mk = (over: Partial<CommandDef>): CommandDef => ({
  code: 'X',
  aliases: [],
  title: 'X',
  module: 'RSI' as CommandDef['module'],
  requiresSymbol: false,
  description: 'X board — something.',
  ...over,
});

describe('isBoard', () => {
  it('accepts a no-symbol command that calls itself a board', () => {
    expect(isBoard(mk({ description: 'RSI screener board — momentum.' }))).toBe(true);
  });
  it('rejects symbol-required commands, non-board descriptions, and the catalog itself', () => {
    expect(isBoard(mk({ requiresSymbol: true, description: 'A board — x.' }))).toBe(false);
    expect(isBoard(mk({ description: 'Multi-exchange compare — best bid/ask.' }))).toBe(false);
    expect(isBoard(mk({ module: 'BOARDS' as CommandDef['module'], description: 'catalog of boards.' }))).toBe(false);
  });
});

describe('classifyBoard', () => {
  const cases: [string, string][] = [
    ['RSI screener board — momentum oscillator', 'Momentum & Oscillators'],
    ['MACD signal board — moving average convergence', 'Trend & Moving Averages'],
    ['Bollinger %B board — volatility bands', 'Volatility & Bands'],
    ['OBV board — on-balance volume accumulation', 'Volume & Flow'],
    ['Ehlers Cyber Cycle board — a cycle', 'Cycles (Ehlers)'],
    ['Sharpe ratio board — risk-adjusted return', 'Risk & Performance'],
  ];
  it.each(cases)('classifies "%s"', (desc, expected) => {
    expect(classifyBoard(mk({ title: desc, description: desc }))).toBe(expected);
  });
});

describe('boardCatalog', () => {
  const cmds: CommandDef[] = [
    mk({ code: 'RSI', title: 'RSI', description: 'RSI board — momentum oscillator.' }),
    mk({ code: 'MACD', title: 'MACD', description: 'MACD board — moving average.' }),
    mk({ code: 'OBV', title: 'OBV', description: 'OBV board — volume.' }),
    mk({ code: 'FUND', title: 'Derivatives', requiresSymbol: false, description: 'Funding rate, OI.' }), // not a board
  ];

  it('groups boards by category and excludes non-boards', () => {
    const groups = boardCatalog(cmds);
    const cats = groups.map((g) => g.category);
    expect(cats).toContain('Momentum & Oscillators');
    expect(cats).toContain('Volume & Flow');
    // FUND is excluded
    expect(groups.flatMap((g) => g.boards).map((b) => b.code)).not.toContain('FUND');
    expect(boardCount(cmds)).toBe(3);
  });

  it('filters by query across code/title/description', () => {
    const groups = boardCatalog(cmds, 'volume');
    const codes = groups.flatMap((g) => g.boards).map((b) => b.code);
    expect(codes).toEqual(['OBV']);
  });

  it('runs over the real registry and finds a large catalog of boards', () => {
    const groups = boardCatalog(COMMANDS);
    const total = groups.flatMap((g) => g.boards).length;
    expect(total).toBe(boardCount(COMMANDS));
    expect(total).toBeGreaterThan(80); // the ~115 indicator boards
    // every board is reachable and the count matches the grouped total (no drops)
    expect(groups.every((g) => g.boards.length > 0)).toBe(true);
  });
});
