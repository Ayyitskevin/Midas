import type { ModuleCode } from '@/modules/meta';
import type { PanelParams } from '@/store/usePanels';
import { MARKET_COMMANDS } from './groups/market';
import { QUANT_COMMANDS } from './groups/quant';
import { PLATFORM_COMMANDS } from './groups/platform';
import { BOARD_COMMANDS } from './groups/boards';
import { UTILITY_COMMANDS } from './groups/utility';

/**
 * The declarative argument grammar a command accepts after its code:
 *   'interval' — one chart-interval token (`BTC/USDT GP 1h`)
 *   'price'    — a threshold, optionally directed (`ALERT 70000`, `ALERT > 70000`)
 *   'text'     — free text, folded into the panel's search query (`SECF bitcoin`)
 * A command without a spec rejects trailing tokens with a visible error
 * instead of silently dropping them.
 */
export type CommandArgSpec = 'interval' | 'price' | 'text';

/** A terminal command (Bloomberg-style mnemonic) the user can type. */
export interface CommandDef {
  code: string;
  aliases: string[];
  title: string;
  /** Which module/panel this command opens. */
  module: ModuleCode;
  /** If true, the command operates on a security and needs a symbol. */
  requiresSymbol: boolean;
  /**
   * If true, the command also works without a symbol but uses one when given
   * (e.g. N/FILLS/XQL). Mutually exclusive with requiresSymbol in practice.
   */
  symbolOptional?: boolean;
  /** Trailing-token grammar, if the command takes arguments. */
  args?: CommandArgSpec;
  description: string;
  /** Default params handed to the module (e.g. chart interval/range). */
  params?: PanelParams;
}

/**
 * The full command registry, assembled in order from per-theme groups
 * (market → quant → platform → boards → utility). The order is preserved
 * exactly: HELP, the command palette and the board catalog all iterate
 * COMMANDS in this order, and COMMAND_CODES mirrors it.
 */
export const COMMANDS: CommandDef[] = [
  ...MARKET_COMMANDS,
  ...QUANT_COMMANDS,
  ...PLATFORM_COMMANDS,
  ...BOARD_COMMANDS,
  ...UTILITY_COMMANDS,
];

const BY_CODE = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  BY_CODE.set(cmd.code, cmd);
  for (const alias of cmd.aliases) BY_CODE.set(alias, cmd);
}

export function lookupCommand(token: string): CommandDef | undefined {
  return BY_CODE.get(token.trim().toUpperCase());
}

/**
 * True when the command's panel should receive a symbol — either because the
 * command strictly requires one (GP) or because it optionally uses one when
 * available (N, FILLS, XQL). The single source of truth for this predicate;
 * the parser, executor and both command UIs all go through it.
 */
export function commandUsesSymbol(cmd: CommandDef): boolean {
  return cmd.requiresSymbol || cmd.symbolOptional === true;
}

/** All distinct command codes (for autocomplete), excluding aliases. */
export const COMMAND_CODES = COMMANDS.map((c) => c.code);
