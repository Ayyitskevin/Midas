import type { CommandDef } from './registry';
import { lookupCommand } from './registry';

export interface ParseResult {
  ok: boolean;
  command?: CommandDef;
  symbol?: string | null;
  /** For the search fallback when no command is recognized. */
  searchQuery?: string;
  error?: string;
}

/**
 * Parse a Bloomberg-style command line.
 *
 * Supported shapes:
 *   AAPL            → default DES for AAPL
 *   AAPL DES        → run DES on AAPL
 *   AAPL GP         → run GP on AAPL
 *   W / HELP / Q    → run a symbol-less command
 *   DES             → run DES on the active symbol (if any)
 *   <free text>     → fall back to security search (SECF)
 *
 * Middle "yellow key" tokens (e.g. `AAPL US Equity DES`) are tolerated: the
 * first token is treated as the symbol and the last recognized token as the
 * command.
 */
export function parseCommand(input: string, activeSymbol: string | null): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Empty command' };

  const tokens = trimmed.toUpperCase().split(/\s+/);

  // Single token: either a bare command or a bare symbol.
  if (tokens.length === 1) {
    const only = tokens[0];
    const cmd = lookupCommand(only);
    if (cmd) {
      const symbol = cmd.requiresSymbol ? activeSymbol : null;
      if (cmd.requiresSymbol && !symbol) {
        return { ok: false, error: `${cmd.code} needs a symbol — try e.g. "AAPL ${cmd.code}"` };
      }
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
    if (lastCmd.requiresSymbol && !symbol) {
      return { ok: false, error: `${lastCmd.code} needs a symbol` };
    }
    return { ok: true, command: lastCmd, symbol: lastCmd.requiresSymbol ? symbol : symbol ?? null };
  }

  // First token might be a symbol-less command with trailing args.
  const firstCmd = lookupCommand(tokens[0]);
  if (firstCmd && !firstCmd.requiresSymbol) {
    return { ok: true, command: firstCmd, symbol: null };
  }

  // Nothing recognized → treat the whole line as a search.
  return {
    ok: true,
    command: lookupCommand('SECF'),
    symbol: null,
    searchQuery: trimmed,
  };
}
