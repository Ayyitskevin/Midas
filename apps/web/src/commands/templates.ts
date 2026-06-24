import type { ModuleCode } from '@/modules/meta';
import type { LinkColor } from '@/store/usePanels';
import { usePanels } from '@/store/usePanels';
import { runCommand } from './execute';

/**
 * A workspace preset: a named bundle of commands that lays out a ready-made
 * set of linked panels in a fresh workspace. Saves the user from typing the
 * same four or five commands every time they want a trading or research view.
 */
export interface WorkspaceTemplate {
  id: string;
  name: string;
  /** One-line summary shown in the picker. */
  description: string;
  /** Command lines run, in order, to populate the new workspace. */
  commands: string[];
  /** Module codes wired into one link group so they share a symbol. */
  link?: ModuleCode[];
}

/** Every templated panel that opts into linking joins this group. */
const TEMPLATE_LINK: LinkColor = 'red';

export const TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'trading',
    name: 'Trading',
    description: 'Chart, order book, time & sales and cross-exchange quotes — all linked.',
    commands: ['BTC/USDT GP', 'BTC/USDT BOOK', 'BTC/USDT TAS', 'BTC/USDT ALLQ'],
    link: ['GP', 'BOOK', 'TAS', 'ALLQ'],
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Description, chart and news for a name, beside a market screener.',
    commands: ['BTC/USDT DES', 'BTC/USDT GP', 'BTC/USDT N', 'SCR'],
    link: ['DES', 'GP', 'N'],
  },
  {
    id: 'derivatives',
    name: 'Derivatives',
    description: 'Funding, open interest and liquidations next to the chart and book.',
    commands: ['BTC/USDT GP', 'BTC/USDT FUND', 'BTC/USDT BOOK', 'BTC/USDT ALLQ'],
    link: ['GP', 'FUND', 'BOOK', 'ALLQ'],
  },
  {
    id: 'monitor',
    name: 'Monitor',
    description: 'Watchlist, live quote grid, top market news and the AI copilot.',
    commands: ['W', 'Q', 'TOP', 'AI'],
  },
];

/**
 * Create a brand-new workspace from a template and populate it. The store's
 * `addWorkspace` makes the new workspace active first, so the subsequent
 * `runCommand` calls land in it; any panels named in `link` are then joined
 * into a single group so navigating one drives the rest.
 */
export function applyTemplate(template: WorkspaceTemplate): string {
  const id = usePanels.getState().addWorkspace(template.name);

  for (const cmd of template.commands) {
    runCommand(cmd);
  }

  if (template.link && template.link.length > 0) {
    const linked = new Set<ModuleCode>(template.link);
    const { panels, setPanelLink } = usePanels.getState();
    for (const p of panels) {
      if (linked.has(p.module)) setPanelLink(p.id, TEMPLATE_LINK);
    }
  }

  return id;
}
