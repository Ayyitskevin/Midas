import { usePanels } from '@/store/usePanels';
import type { PanelParams, PanelState } from '@/store/usePanels';
import { useSettings } from '@/store/useSettings';
import { chartParamsFor } from '@/lib/settings';
import { parseCommand } from './parser';
import type { CommandDef } from './registry';
import { lookupCommand } from './registry';

/** Open the panel for a resolved command + symbol. */
export function openCommand(
  command: CommandDef,
  symbol: string | null,
  searchQuery?: string,
): void {
  // Only DES/GP/GIP strictly require a symbol; N optionally uses one.
  const usesSymbol = command.requiresSymbol || command.code === 'N';
  const params: PanelParams = { ...(command.params ?? {}) };
  // A fresh price chart honours the user's default-timeframe preference.
  const chart = chartParamsFor(command.code, useSettings.getState().settings);
  if (chart) {
    params.interval = chart.interval;
    params.range = chart.range;
  }
  if (searchQuery) params.query = searchQuery;

  usePanels.getState().openPanel({
    module: command.module,
    symbol: usesSymbol ? symbol : null,
    title: command.title,
    params: Object.keys(params).length > 0 ? params : undefined,
  });
}

/** Parse a raw command line and open the corresponding panel. */
export function runCommand(input: string): { ok: boolean; error?: string } {
  const { activeSymbol } = usePanels.getState();
  const result = parseCommand(input, activeSymbol);
  if (!result.ok || !result.command) {
    return { ok: false, error: result.error ?? 'Unknown command' };
  }
  openCommand(result.command, result.symbol ?? null, result.searchQuery);
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
