import type { ModuleCode } from '@/modules/meta';
import type { PanelParams } from '@/store/usePanels';
import { MARKET_COMMANDS } from './groups/market';
import { QUANT_COMMANDS } from './groups/quant';
import { PLATFORM_COMMANDS } from './groups/platform';
import { BOARD_COMMANDS } from './groups/boards';
import { UTILITY_COMMANDS } from './groups/utility';

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

/** All distinct command codes (for autocomplete), excluding aliases. */
export const COMMAND_CODES = COMMANDS.map((c) => c.code);
