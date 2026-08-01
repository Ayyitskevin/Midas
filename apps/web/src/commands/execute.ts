import { usePanels } from '@/store/usePanels';
import type { PanelParams, PanelState } from '@/store/usePanels';
import { useSettings } from '@/store/useSettings';
import { useAlerts } from '@/store/useAlerts';
import { useToasts } from '@/store/useToasts';
import { chartParamsFor } from '@/lib/settings';
import { opSymbol } from '@/lib/alerts';
import { fmtPrice } from '@/lib/format';
import { parseCommand } from './parser';
import type { CommandArgs } from './parser';
import type { CommandDef } from './registry';
import { commandUsesSymbol, lookupCommand } from './registry';

/** Open the panel for a resolved command + symbol. */
export function openCommand(
  command: CommandDef,
  symbol: string | null,
  searchQuery?: string,
  args?: CommandArgs,
): void {
  const usesSymbol = commandUsesSymbol(command);
  const params: PanelParams = { ...(command.params ?? {}) };
  // A fresh price chart honours the user's default-timeframe preference…
  const chart = chartParamsFor(command.code, useSettings.getState().settings);
  if (chart) {
    params.interval = chart.interval;
    params.range = chart.range;
  }
  // …but an explicit interval arg (`BTC/USDT GP 1h`) beats that default.
  if (args?.kind === 'interval') {
    params.interval = args.interval;
    params.range = args.range;
  }
  if (searchQuery) params.query = searchQuery;

  usePanels.getState().openPanel({
    module: command.module,
    symbol: usesSymbol ? symbol : null,
    title: command.title,
    params: Object.keys(params).length > 0 ? params : undefined,
  });
}

/**
 * Arm a LOCAL price alert straight from the command line
 * (`BTC/USDT ALERT > 70000`). Local means client-side: it is evaluated by this
 * tab's engine and only fires while the terminal is open — the confirmation
 * toast says so, and notes when the panel is set to server mode (where the new
 * local alert is not listed).
 */
function armPriceAlert(symbol: string, args: Extract<CommandArgs, { kind: 'price' }>): void {
  const { mode, addAlert } = useAlerts.getState();
  addAlert({ symbol, metric: 'price', op: args.op, value: args.value, repeat: false });
  useToasts.getState().push({
    title: 'Local alert armed',
    body:
      `${symbol} price ${opSymbol(args.op)} ${fmtPrice(args.value)} — local: fires while this ` +
      `terminal tab is open${mode === 'server' ? ' (stored in the local list; the panel is in server mode)' : ''}.`,
    tone: 'up',
  });
}

/** Parse a raw command line and open the corresponding panel. */
export function runCommand(input: string): { ok: boolean; error?: string } {
  const { activeSymbol } = usePanels.getState();
  const result = parseCommand(input, activeSymbol);
  if (!result.ok || !result.command) {
    return { ok: false, error: result.error ?? 'Unknown command' };
  }
  const symbol = result.symbol ?? null;
  if (result.args?.kind === 'price' && result.command.code === 'ALERT' && symbol) {
    armPriceAlert(symbol, result.args);
  }
  openCommand(result.command, symbol, result.searchQuery, result.args);
  return { ok: true };
}

/** Convenience: open the default description view for a symbol. */
export function openSymbol(symbol: string): void {
  const des = lookupCommand('DES');
  if (des) openCommand(des, symbol);
}

/** Convenience: open a specific module code for a symbol (e.g. GP, N). */
export function openModule(code: string, symbol: string | null): void {
  const cmd = lookupCommand(code);
  if (cmd) openCommand(cmd, symbol);
}

/**
 * Navigate a symbol from within a panel. If the panel belongs to a link group,
 * the symbol is broadcast to the whole group (the panel acts as a navigator);
 * otherwise it opens a fresh description panel.
 */
export function navigate(panel: PanelState, symbol: string): void {
  if (panel.link) {
    usePanels.getState().setPanelSymbol(panel.id, symbol);
  } else {
    openSymbol(symbol);
  }
}
