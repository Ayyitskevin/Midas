/**
 * Module metadata — pure data with no React imports, so it can be shared by the
 * command registry, the panel store, and the component registry without cycles.
 */

export type ModuleCode =
  | 'DES'
  | 'GP'
  | 'COMP'
  | 'RATIO'
  | 'PAIR'
  | 'BOOK'
  | 'DEPTH'
  | 'TAS'
  | 'CVD'
  | 'IMB'
  | 'LQA'
  | 'ALLQ'
  | 'FUND'
  | 'FUNDR'
  | 'CARRY'
  | 'FPL'
  | 'FRH'
  | 'LIQS'
  | 'SCR'
  | 'HEAT'
  | 'MOV'
  | 'CORR'
  | 'BETA'
  | 'RBETA'
  | 'SCAT'
  | 'VPVR'
  | 'SHARPE'
  | 'DD'
  | 'CAL'
  | 'VOL'
  | 'VAR'
  | 'VTS'
  | 'VCONE'
  | 'MC'
  | 'MOM'
  | 'RRG'
  | 'SEAS'
  | 'MRET'
  | 'RCAL'
  | 'PREM'
  | 'ARB'
  | 'SLIP'
  | 'TWAP'
  | 'AI'
  | 'W'
  | 'N'
  | 'Q'
  | 'PORT'
  | 'RHEAT'
  | 'EXP'
  | 'PBETA'
  | 'ALERT'
  | 'NOTE'
  | 'RISK'
  | 'CONV'
  | 'KELLY'
  | 'ROR'
  | 'LADDER'
  | 'DCA'
  | 'LOG'
  | 'EQ'
  | 'PNL'
  | 'ACCT'
  | 'PREF'
  | 'REPORT'
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
  COMP: { code: 'COMP', title: 'Compare', w: 6, h: 11, minW: 4, minH: 8 },
  RATIO: { code: 'RATIO', title: 'Ratio / Spread', w: 6, h: 10, minW: 4, minH: 7 },
  PAIR: { code: 'PAIR', title: 'Pairs Z-Score', w: 6, h: 11, minW: 4, minH: 7 },
  BOOK: { code: 'BOOK', title: 'Order Book', w: 4, h: 12, minW: 3, minH: 8 },
  DEPTH: { code: 'DEPTH', title: 'Depth Heatmap', w: 6, h: 11, minW: 4, minH: 7 },
  TAS: { code: 'TAS', title: 'Time & Sales', w: 4, h: 12, minW: 3, minH: 8 },
  CVD: { code: 'CVD', title: 'Order Flow', w: 5, h: 11, minW: 4, minH: 7 },
  IMB: { code: 'IMB', title: 'Book Imbalance', w: 5, h: 11, minW: 4, minH: 6 },
  LQA: { code: 'LQA', title: 'Liquidity', w: 5, h: 11, minW: 4, minH: 6 },
  ALLQ: { code: 'ALLQ', title: 'Multi-Exchange', w: 5, h: 8, minW: 4, minH: 5 },
  FUND: { code: 'FUND', title: 'Derivatives', w: 4, h: 11, minW: 3, minH: 7 },
  FUNDR: { code: 'FUNDR', title: 'Funding Rates', w: 5, h: 11, minW: 4, minH: 6 },
  CARRY: { code: 'CARRY', title: 'Funding Carry', w: 6, h: 11, minW: 4, minH: 6 },
  FPL: { code: 'FPL', title: 'Funding P&L', w: 5, h: 13, minW: 4, minH: 8 },
  FRH: { code: 'FRH', title: 'Funding History', w: 5, h: 11, minW: 4, minH: 6 },
  LIQS: { code: 'LIQS', title: 'Liquidations', w: 5, h: 11, minW: 4, minH: 6 },
  SCR: { code: 'SCR', title: 'Screener', w: 4, h: 11, minW: 3, minH: 6 },
  HEAT: { code: 'HEAT', title: 'Heatmap', w: 6, h: 9, minW: 4, minH: 5 },
  MOV: { code: 'MOV', title: 'Market Overview', w: 6, h: 9, minW: 4, minH: 6 },
  CORR: { code: 'CORR', title: 'Correlation', w: 5, h: 8, minW: 4, minH: 5 },
  BETA: { code: 'BETA', title: 'Beta vs BTC', w: 5, h: 11, minW: 4, minH: 6 },
  RBETA: { code: 'RBETA', title: 'Rolling Beta', w: 5, h: 11, minW: 4, minH: 7 },
  SCAT: { code: 'SCAT', title: 'Returns Scatter', w: 5, h: 11, minW: 4, minH: 7 },
  VPVR: { code: 'VPVR', title: 'Volume Profile', w: 5, h: 11, minW: 4, minH: 7 },
  SHARPE: { code: 'SHARPE', title: 'Risk-Adjusted', w: 5, h: 11, minW: 4, minH: 6 },
  DD: { code: 'DD', title: 'Drawdown', w: 6, h: 11, minW: 4, minH: 6 },
  CAL: { code: 'CAL', title: 'Market Calendar', w: 4, h: 13, minW: 3, minH: 7 },
  VOL: { code: 'VOL', title: 'Volatility', w: 5, h: 12, minW: 4, minH: 6 },
  VAR: { code: 'VAR', title: 'Returns / VaR', w: 6, h: 11, minW: 4, minH: 7 },
  VTS: { code: 'VTS', title: 'Vol Term Structure', w: 5, h: 11, minW: 4, minH: 6 },
  VCONE: { code: 'VCONE', title: 'Vol Cones', w: 5, h: 11, minW: 4, minH: 7 },
  MC: { code: 'MC', title: 'Monte Carlo', w: 6, h: 11, minW: 4, minH: 7 },
  MOM: { code: 'MOM', title: 'Momentum', w: 5, h: 12, minW: 4, minH: 6 },
  RRG: { code: 'RRG', title: 'Rotation (RRG)', w: 6, h: 11, minW: 4, minH: 7 },
  SEAS: { code: 'SEAS', title: 'Seasonality', w: 6, h: 10, minW: 4, minH: 6 },
  MRET: { code: 'MRET', title: 'Monthly Returns', w: 6, h: 10, minW: 4, minH: 6 },
  RCAL: { code: 'RCAL', title: 'Returns Calendar', w: 6, h: 9, minW: 4, minH: 6 },
  PREM: { code: 'PREM', title: 'Basis Monitor', w: 4, h: 13, minW: 3, minH: 8 },
  ARB: { code: 'ARB', title: 'Arb Scanner', w: 4, h: 12, minW: 3, minH: 7 },
  SLIP: { code: 'SLIP', title: 'Slippage', w: 4, h: 13, minW: 3, minH: 8 },
  TWAP: { code: 'TWAP', title: 'Execution (TWAP)', w: 5, h: 13, minW: 4, minH: 8 },
  AI: { code: 'AI', title: 'Copilot', w: 4, h: 12, minW: 3, minH: 8 },
  W: { code: 'W', title: 'Watchlist', w: 3, h: 12, minW: 2, minH: 6 },
  N: { code: 'N', title: 'News', w: 4, h: 12, minW: 3, minH: 6 },
  Q: { code: 'Q', title: 'Quote Monitor', w: 5, h: 9, minW: 3, minH: 5 },
  PORT: { code: 'PORT', title: 'Portfolio', w: 7, h: 9, minW: 5, minH: 5 },
  RHEAT: { code: 'RHEAT', title: 'Position Risk', w: 6, h: 11, minW: 4, minH: 6 },
  EXP: { code: 'EXP', title: 'Exposure', w: 6, h: 11, minW: 4, minH: 6 },
  PBETA: { code: 'PBETA', title: 'Portfolio Beta', w: 5, h: 12, minW: 4, minH: 7 },
  ALERT: { code: 'ALERT', title: 'Alerts', w: 5, h: 12, minW: 4, minH: 8 },
  NOTE: { code: 'NOTE', title: 'Notes', w: 4, h: 9, minW: 3, minH: 5 },
  RISK: { code: 'RISK', title: 'Position Sizer', w: 4, h: 13, minW: 3, minH: 9 },
  CONV: { code: 'CONV', title: 'Size Converter', w: 4, h: 12, minW: 3, minH: 8 },
  KELLY: { code: 'KELLY', title: 'Kelly Sizer', w: 4, h: 12, minW: 3, minH: 8 },
  ROR: { code: 'ROR', title: 'Risk of Ruin', w: 4, h: 13, minW: 3, minH: 9 },
  LADDER: { code: 'LADDER', title: 'Scale-in Ladder', w: 4, h: 14, minW: 3, minH: 9 },
  DCA: { code: 'DCA', title: 'DCA / Averaging', w: 4, h: 14, minW: 3, minH: 9 },
  LOG: { code: 'LOG', title: 'Trade Journal', w: 5, h: 14, minW: 4, minH: 8 },
  EQ: { code: 'EQ', title: 'Equity Curve', w: 5, h: 11, minW: 4, minH: 7 },
  PNL: { code: 'PNL', title: 'P&L Calculator', w: 4, h: 13, minW: 3, minH: 8 },
  ACCT: { code: 'ACCT', title: 'Account', w: 4, h: 10, minW: 3, minH: 6 },
  PREF: { code: 'PREF', title: 'Preferences', w: 4, h: 13, minW: 3, minH: 8 },
  REPORT: { code: 'REPORT', title: 'Reports / Export', w: 4, h: 13, minW: 3, minH: 6 },
  HELP: { code: 'HELP', title: 'Help', w: 5, h: 10, minW: 3, minH: 6 },
  SECF: { code: 'SECF', title: 'Security Finder', w: 4, h: 9, minW: 3, minH: 5 },
};
