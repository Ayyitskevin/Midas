import type { AlertOp, Interval, Range } from '@midas/shared';
import type { CommandDef } from './registry';
import { commandUsesSymbol, lookupCommand } from './registry';

/** Parsed trailing arguments for a command that declares an args spec. */
export type CommandArgs =
  | { kind: 'interval'; interval: Interval; range: Range }
  | { kind: 'price'; op: AlertOp; value: number };

export interface ParseResult {
  ok: boolean;
  command?: CommandDef;
  symbol?: string | null;
  /** For the search fallback when no command is recognized. */
  searchQuery?: string;
  /** Validated arguments when the command declares an args spec. */
  args?: CommandArgs;
  error?: string;
}

/**
 * Interval tokens a trader can type after GP/GIP, mapped to the chart's
 * intervals. `1h`/`1D`/`1W` spellings are accepted as aliases for the shared
 * `60m`/`1d`/`1wk` intervals; anything else is an honest error, not a guess.
 */
const INTERVAL_TOKENS: Record<string, Interval> = {
  '1M': '1m',
  '2M': '2m',
  '5M': '5m',
  '15M': '15m',
  '30M': '30m',
  '60M': '60m',
  '90M': '90m',
  '1H': '60m',
  '1D': '1d',
  D: '1d',
  '1W': '1wk',
  '1WK': '1wk',
  '1MO': '1mo',
};

/** The friendly list shown in error messages and autocomplete hints. */
export const INTERVAL_ARG_CHOICES: readonly string[] = ['5m', '15m', '30m', '1h', '1D', '1W'];
export const INTERVAL_ARG_HINT = INTERVAL_ARG_CHOICES.join(' ');

/** A sensible lookback for an explicitly chosen interval (mirrors the chart presets). */
function defaultRangeFor(interval: Interval): Range {
  switch (interval) {
    case '1m':
    case '2m':
    case '5m':
      return '1d';
    case '15m':
    case '30m':
    case '60m':
    case '90m':
      return '5d';
    case '1d':
      return '6mo';
    case '1wk':
      return '5y';
    case '1mo':
      return 'max';
  }
}

/** Direction words/symbols accepted before an ALERT threshold. */
const PRICE_OPS: Record<string, AlertOp> = {
  '>': 'above',
  '>=': 'above',
  '<': 'below',
  '<=': 'below',
  X: 'cross',
  CROSS: 'cross',
};

/** Validate trailing tokens against a command's args spec. */
function parseArgs(
  cmd: CommandDef,
  argTokens: string[],
): { args?: CommandArgs; searchQuery?: string; error?: string } {
  switch (cmd.args) {
    case 'interval': {
      if (argTokens.length !== 1) {
        return { error: `${cmd.code}: expected one interval, e.g. "BTC/USDT ${cmd.code} 1h"` };
      }
      const interval = INTERVAL_TOKENS[argTokens[0]];
      if (!interval) {
        return {
          error: `${cmd.code}: unknown interval '${argTokens[0]}' (try ${INTERVAL_ARG_HINT})`,
        };
      }
      return { args: { kind: 'interval', interval, range: defaultRangeFor(interval) } };
    }
    case 'price': {
      let op: AlertOp = 'cross';
      let valueToken: string | undefined;
      if (argTokens.length === 1) {
        valueToken = argTokens[0];
      } else if (argTokens.length === 2 && PRICE_OPS[argTokens[0]]) {
        op = PRICE_OPS[argTokens[0]];
        valueToken = argTokens[1];
      }
      const value = valueToken !== undefined ? Number(valueToken) : NaN;
      if (valueToken === undefined || !Number.isFinite(value) || value <= 0) {
        return {
          error: `${cmd.code}: expected a price, e.g. "BTC/USDT ${cmd.code} 70000" or "${cmd.code} > 70000"`,
        };
      }
      return { args: { kind: 'price', op, value } };
    }
    case 'text':
      return { searchQuery: argTokens.join(' ') };
    default:
      return { error: `${cmd.code} takes no arguments — '${argTokens.join(' ')}'` };
  }
}

/** True when a token looks like it could be a ticker (short, all letters). */
function tickerish(token: string): boolean {
  return /^[A-Z]{1,5}$/.test(token);
}

/**
 * Parse a Bloomberg-style command line.
 *
 * Supported shapes:
 *   BTC/USDT             → default DES for BTC/USDT
 *   BTC/USDT DES         → run DES on BTC/USDT
 *   BTC/USDT GP          → run GP on BTC/USDT
 *   BTC/USDT GP 1h       → run GP on BTC/USDT at a 1h interval (args grammar)
 *   BTC/USDT ALERT > 70000 → arm a price alert (args grammar)
 *   W / HELP / Q         → run a symbol-less command
 *   DES                  → run DES on the active symbol (if any)
 *   GP 1h                → run GP on the active symbol at 1h
 *   N                    → symbol-optional command on the active symbol (if any)
 *   $ARB                 → force symbol resolution when a ticker collides with
 *                          a command mnemonic (also ARB/USDT works)
 *   <free text>          → fall back to security search (SECF)
 *
 * Middle "yellow key" tokens (e.g. `BTC USDT PERP DES`) are tolerated: when
 * the LAST token is the command, the first token is the symbol and anything in
 * between is ignored. Otherwise the first command token in the line takes the
 * remaining tokens as its arguments — a command without an args spec rejects
 * them with a visible error rather than silently dropping or searching.
 */
export function parseCommand(input: string, activeSymbol: string | null): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Empty command' };

  const tokens = trimmed.toUpperCase().split(/\s+/);

  // `$` forces the first token to be read as a symbol even when it collides
  // with a command mnemonic (`$ARB` → the Arbitrum token's DES, not the ARB
  // board). Works for any symbol — no hardcoded coin list.
  if (tokens[0].startsWith('$')) {
    tokens[0] = tokens[0].slice(1);
    if (!tokens[0]) return { ok: false, error: 'Expected a symbol after $' };
    if (tokens.length === 1) {
      return { ok: true, command: lookupCommand('DES'), symbol: tokens[0] };
    }
    // Multi-token: fall through with the stripped symbol; the command lookup
    // below never re-reads the first token as a command.
    const last = tokens[tokens.length - 1];
    const lastCmd = lookupCommand(last);
    if (lastCmd && tokens.length > 2) {
      return { ok: true, command: lastCmd, symbol: commandUsesSymbol(lastCmd) ? tokens[0] : null };
    }
    const cmd = lookupCommand(tokens[1]);
    if (!cmd) {
      return { ok: true, command: lookupCommand('DES'), symbol: tokens[0] };
    }
    return finishArgs(cmd, tokens[0], tokens.slice(2), activeSymbol);
  }

  // Single token: either a bare command or a bare symbol.
  if (tokens.length === 1) {
    const only = tokens[0];
    const cmd = lookupCommand(only);
    if (cmd) {
      if (cmd.requiresSymbol && !activeSymbol) {
        return { ok: false, error: `${cmd.code} needs a symbol — try e.g. "BTC/USDT ${cmd.code}"` };
      }
      // Symbol-optional commands (N, FILLS, XQL) fall back to the active
      // symbol when one is loaded; symbol-less commands never take one.
      const symbol = cmd.requiresSymbol
        ? activeSymbol
        : cmd.symbolOptional
          ? activeSymbol
          : null;
      return { ok: true, command: cmd, symbol };
    }
    // Bare symbol → default to security description.
    return { ok: true, command: lookupCommand('DES'), symbol: only };
  }

  // Multiple tokens: prefer the last token as the command.
  const last = tokens[tokens.length - 1];
  const lastCmd = lookupCommand(last);
  if (lastCmd) {
    const symbol = tokens[0];
    return { ok: true, command: lastCmd, symbol: commandUsesSymbol(lastCmd) ? symbol : null };
  }

  // Otherwise the first command token in the line takes the rest of the line
  // as arguments (`BTC/USDT GP 1h`, `GP 1h` on the active symbol).
  for (let i = 0; i < tokens.length - 1; i++) {
    const cmd = lookupCommand(tokens[i]);
    if (cmd) {
      const symbol = i > 0 ? tokens[0] : activeSymbol;
      const result = finishArgs(cmd, symbol, tokens.slice(i + 1), activeSymbol);
      // A bare ticker-ish command word (`ARB 1h`) most likely meant the token:
      // point at the escape hatch instead of leaving the trader stuck.
      if (!result.ok && i === 0 && tickerish(tokens[0])) {
        return {
          ...result,
          error: `${result.error} — if you meant the ticker, try $${tokens[0]} or ${tokens[0]}/USDT`,
        };
      }
      return result;
    }
  }

  // Nothing recognized → treat the whole line as a search.
  return {
    ok: true,
    command: lookupCommand('SECF'),
    symbol: null,
    searchQuery: trimmed,
  };
}

/** Resolve the symbol + validate trailing args for a mid-line command match. */
function finishArgs(
  cmd: CommandDef,
  typedSymbol: string | null,
  argTokens: string[],
  activeSymbol: string | null,
): ParseResult {
  const usesSymbol = commandUsesSymbol(cmd);
  const symbol = usesSymbol ? (typedSymbol ?? activeSymbol) : null;
  if (argTokens.length === 0) {
    if (cmd.requiresSymbol && !symbol) {
      return { ok: false, error: `${cmd.code} needs a symbol — try e.g. "BTC/USDT ${cmd.code}"` };
    }
    return { ok: true, command: cmd, symbol };
  }
  if (!cmd.args) {
    return { ok: false, error: `${cmd.code} takes no arguments — '${argTokens.join(' ')}'` };
  }
  // Arguments that name a level on a security are meaningless without one.
  if (usesSymbol && !symbol) {
    return {
      ok: false,
      error: `${cmd.code} needs a symbol — try e.g. "BTC/USDT ${cmd.code} ${argTokens.join(' ')}"`,
    };
  }
  const parsed = parseArgs(cmd, argTokens);
  if (parsed.error) return { ok: false, error: parsed.error };
  return { ok: true, command: cmd, symbol, args: parsed.args, searchQuery: parsed.searchQuery };
}
