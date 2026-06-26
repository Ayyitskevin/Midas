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
  | 'AVGCORR'
  | 'BREADTH'
  | 'BETA'
  | 'CAPTURE'
  | 'RBETA'
  | 'SCAT'
  | 'VPVR'
  | 'SHARPE'
  | 'RSHARPE'
  | 'DD'
  | 'CALMAR'
  | 'CAL'
  | 'VOL'
  | 'VAR'
  | 'SKEW'
  | 'VTS'
  | 'VCONE'
  | 'MC'
  | 'BACKTEST'
  | 'MOM'
  | 'STRETCH'
  | 'HURST'
  | 'EFFICIENCY'
  | 'SCAN'
  | 'MTF'
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
  | 'REBAL'
  | 'RPARITY'
  | 'OPT'
  | 'MSR'
  | 'FRONTIER'
  | 'RISKB'
  | 'ULCER'
  | 'GPR'
  | 'OMEGA'
  | 'DIVR'
  | 'TAIL'
  | 'PAIN'
  | 'KRATIO'
  | 'VREG'
  | 'ACF'
  | 'STERLING'
  | 'INFO'
  | 'BURKE'
  | 'TREYNOR'
  | 'ALPHA'
  | 'APPRAISAL'
  | 'M2'
  | 'CSR'
  | 'RSTAB'
  | 'ASR'
  | 'BETAETH'
  | 'MARTIN'
  | 'LEADLAG'
  | 'DDREC'
  | 'VOV'
  | 'STREAK'
  | 'RANGE'
  | 'UVOL'
  | 'GAP'
  | 'HILO'
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
  AVGCORR: { code: 'AVGCORR', title: 'Correlation Regime', w: 6, h: 10, minW: 4, minH: 6 },
  BREADTH: { code: 'BREADTH', title: 'Breadth Oscillator', w: 6, h: 10, minW: 4, minH: 6 },
  BETA: { code: 'BETA', title: 'Beta vs BTC', w: 5, h: 11, minW: 4, minH: 6 },
  CAPTURE: { code: 'CAPTURE', title: 'Up/Down Capture', w: 5, h: 11, minW: 4, minH: 6 },
  RBETA: { code: 'RBETA', title: 'Rolling Beta', w: 5, h: 11, minW: 4, minH: 7 },
  SCAT: { code: 'SCAT', title: 'Returns Scatter', w: 5, h: 11, minW: 4, minH: 7 },
  VPVR: { code: 'VPVR', title: 'Volume Profile', w: 5, h: 11, minW: 4, minH: 7 },
  SHARPE: { code: 'SHARPE', title: 'Risk-Adjusted', w: 5, h: 11, minW: 4, minH: 6 },
  RSHARPE: { code: 'RSHARPE', title: 'Rolling Sharpe', w: 6, h: 10, minW: 4, minH: 6 },
  DD: { code: 'DD', title: 'Drawdown', w: 6, h: 11, minW: 4, minH: 6 },
  CALMAR: { code: 'CALMAR', title: 'Calmar Ratio', w: 5, h: 11, minW: 4, minH: 6 },
  CAL: { code: 'CAL', title: 'Market Calendar', w: 4, h: 13, minW: 3, minH: 7 },
  VOL: { code: 'VOL', title: 'Volatility', w: 5, h: 12, minW: 4, minH: 6 },
  VAR: { code: 'VAR', title: 'Returns / VaR', w: 6, h: 11, minW: 4, minH: 7 },
  SKEW: { code: 'SKEW', title: 'Return Shape', w: 5, h: 11, minW: 4, minH: 6 },
  VTS: { code: 'VTS', title: 'Vol Term Structure', w: 5, h: 11, minW: 4, minH: 6 },
  VCONE: { code: 'VCONE', title: 'Vol Cones', w: 5, h: 11, minW: 4, minH: 7 },
  MC: { code: 'MC', title: 'Monte Carlo', w: 6, h: 11, minW: 4, minH: 7 },
  BACKTEST: { code: 'BACKTEST', title: 'Backtest', w: 6, h: 11, minW: 4, minH: 7 },
  MOM: { code: 'MOM', title: 'Momentum', w: 5, h: 12, minW: 4, minH: 6 },
  STRETCH: { code: 'STRETCH', title: 'Stretch Screener', w: 5, h: 12, minW: 4, minH: 6 },
  HURST: { code: 'HURST', title: 'Trend / Revert', w: 5, h: 12, minW: 4, minH: 6 },
  EFFICIENCY: { code: 'EFFICIENCY', title: 'Trend Efficiency', w: 5, h: 12, minW: 4, minH: 6 },
  SCAN: { code: 'SCAN', title: 'Signal Scan', w: 5, h: 12, minW: 4, minH: 6 },
  MTF: { code: 'MTF', title: 'Multi-Timeframe', w: 4, h: 11, minW: 3, minH: 7 },
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
  REBAL: { code: 'REBAL', title: 'Rebalance', w: 5, h: 12, minW: 4, minH: 7 },
  RPARITY: { code: 'RPARITY', title: 'Risk Parity', w: 5, h: 12, minW: 4, minH: 6 },
  OPT: { code: 'OPT', title: 'Min Variance', w: 5, h: 12, minW: 4, minH: 6 },
  MSR: { code: 'MSR', title: 'Max Sharpe', w: 5, h: 12, minW: 4, minH: 6 },
  FRONTIER: { code: 'FRONTIER', title: 'Efficient Frontier', w: 6, h: 13, minW: 4, minH: 8 },
  RISKB: { code: 'RISKB', title: 'Risk Budget', w: 5, h: 12, minW: 4, minH: 6 },
  ULCER: { code: 'ULCER', title: 'Ulcer Index', w: 5, h: 12, minW: 4, minH: 6 },
  GPR: { code: 'GPR', title: 'Gain to Pain', w: 5, h: 12, minW: 4, minH: 6 },
  OMEGA: { code: 'OMEGA', title: 'Omega Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  DIVR: { code: 'DIVR', title: 'Diversification', w: 5, h: 12, minW: 4, minH: 6 },
  TAIL: { code: 'TAIL', title: 'Tail Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  PAIN: { code: 'PAIN', title: 'Pain Index', w: 5, h: 12, minW: 4, minH: 6 },
  KRATIO: { code: 'KRATIO', title: 'K-Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  VREG: { code: 'VREG', title: 'Vol Regime', w: 5, h: 12, minW: 4, minH: 6 },
  ACF: { code: 'ACF', title: 'Autocorrelation', w: 5, h: 12, minW: 4, minH: 6 },
  STERLING: { code: 'STERLING', title: 'Sterling Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  INFO: { code: 'INFO', title: 'Information Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  BURKE: { code: 'BURKE', title: 'Burke Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  TREYNOR: { code: 'TREYNOR', title: 'Treynor Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  ALPHA: { code: 'ALPHA', title: "Jensen's Alpha", w: 5, h: 12, minW: 4, minH: 6 },
  APPRAISAL: { code: 'APPRAISAL', title: 'Appraisal Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  M2: { code: 'M2', title: 'M² (Modigliani)', w: 5, h: 12, minW: 4, minH: 6 },
  CSR: { code: 'CSR', title: 'Common-Sense Ratio', w: 5, h: 12, minW: 4, minH: 6 },
  RSTAB: { code: 'RSTAB', title: 'Rolling-Sharpe Stability', w: 5, h: 12, minW: 4, minH: 6 },
  ASR: { code: 'ASR', title: 'Adjusted Sharpe', w: 5, h: 12, minW: 4, minH: 6 },
  BETAETH: { code: 'BETAETH', title: 'Beta vs ETH / BTC', w: 5, h: 12, minW: 4, minH: 6 },
  MARTIN: { code: 'MARTIN', title: 'Martin Ratio (UPI)', w: 5, h: 11, minW: 4, minH: 6 },
  LEADLAG: { code: 'LEADLAG', title: 'Lead-Lag vs BTC', w: 5, h: 12, minW: 4, minH: 6 },
  DDREC: { code: 'DDREC', title: 'Drawdown Recovery', w: 5, h: 12, minW: 4, minH: 6 },
  VOV: { code: 'VOV', title: 'Vol of Vol', w: 5, h: 12, minW: 4, minH: 6 },
  STREAK: { code: 'STREAK', title: 'Up/Down Streaks', w: 5, h: 12, minW: 4, minH: 6 },
  RANGE: { code: 'RANGE', title: 'Range Expansion', w: 5, h: 12, minW: 4, minH: 6 },
  UVOL: { code: 'UVOL', title: 'Unusual Volume', w: 5, h: 12, minW: 4, minH: 6 },
  GAP: { code: 'GAP', title: 'Gap Board', w: 5, h: 12, minW: 4, minH: 6 },
  HILO: { code: 'HILO', title: 'High/Low Proximity', w: 5, h: 12, minW: 4, minH: 6 },
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
