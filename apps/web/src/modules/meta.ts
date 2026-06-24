/**
 * Module metadata — pure data with no React imports, so it can be shared by the
 * command registry, the panel store, and the component registry without cycles.
 */

export type ModuleCode =
  | 'DES'
  | 'GP'
  | 'BOOK'
  | 'TAS'
  | 'ALLQ'
  | 'FUND'
  | 'SCR'
  | 'AI'
  | 'W'
  | 'N'
  | 'Q'
  | 'PORT'
  | 'ALERT'
  | 'HELP'
  | 'SECF';

export interface ModuleMeta {
  code: ModuleCode;
  /** Default panel title. */
  title: string;
  /** Default grid footprint (12-column grid). */
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export const MODULE_META: Record<ModuleCode, ModuleMeta> = {
  DES: { code: 'DES', title: 'Security Description', w: 4, h: 9, minW: 3, minH: 6 },
  GP: { code: 'GP', title: 'Price Graph', w: 6, h: 11, minW: 4, minH: 8 },
  BOOK: { code: 'BOOK', title: 'Order Book', w: 4, h: 12, minW: 3, minH: 8 },
  TAS: { code: 'TAS', title: 'Time & Sales', w: 4, h: 12, minW: 3, minH: 8 },
  ALLQ: { code: 'ALLQ', title: 'Multi-Exchange', w: 5, h: 8, minW: 4, minH: 5 },
  FUND: { code: 'FUND', title: 'Derivatives', w: 4, h: 11, minW: 3, minH: 7 },
  SCR: { code: 'SCR', title: 'Screener', w: 4, h: 11, minW: 3, minH: 6 },
  AI: { code: 'AI', title: 'Copilot', w: 4, h: 12, minW: 3, minH: 8 },
  W: { code: 'W', title: 'Watchlist', w: 3, h: 12, minW: 2, minH: 6 },
  N: { code: 'N', title: 'News', w: 4, h: 12, minW: 3, minH: 6 },
  Q: { code: 'Q', title: 'Quote Monitor', w: 5, h: 9, minW: 3, minH: 5 },
  PORT: { code: 'PORT', title: 'Portfolio', w: 7, h: 9, minW: 5, minH: 5 },
  ALERT: { code: 'ALERT', title: 'Alerts', w: 5, h: 12, minW: 4, minH: 8 },
  HELP: { code: 'HELP', title: 'Help', w: 5, h: 10, minW: 3, minH: 6 },
  SECF: { code: 'SECF', title: 'Security Finder', w: 4, h: 9, minW: 3, minH: 5 },
};
