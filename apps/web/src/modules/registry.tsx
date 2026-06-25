import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModuleCode } from './meta';
import type { ModuleProps } from './types';

/**
 * Lazily load a module by its named export so each panel module becomes its own
 * Vite chunk, fetched only when a panel of that type first opens. This keeps
 * heavy dependencies (e.g. lightweight-charts behind GP) out of the initial
 * bundle. Panel renders these inside a <Suspense> boundary.
 */
function mod(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
): LazyExoticComponent<ComponentType<ModuleProps>> {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType<ModuleProps> }));
}

/** Maps a module code to the (lazily-loaded) component that renders it. */
export const MODULE_COMPONENTS: Record<ModuleCode, LazyExoticComponent<ComponentType<ModuleProps>>> = {
  DES: mod(() => import('./DescriptionModule'), 'DescriptionModule'),
  GP: mod(() => import('./ChartModule'), 'ChartModule'),
  COMP: mod(() => import('./ComparisonModule'), 'ComparisonModule'),
  RATIO: mod(() => import('./RatioModule'), 'RatioModule'),
  BOOK: mod(() => import('./OrderBookModule'), 'OrderBookModule'),
  DEPTH: mod(() => import('./OrderBookDepthHeatmapModule'), 'OrderBookDepthHeatmapModule'),
  TAS: mod(() => import('./TradesModule'), 'TradesModule'),
  ALLQ: mod(() => import('./MultiExchangeModule'), 'MultiExchangeModule'),
  FUND: mod(() => import('./DerivativesModule'), 'DerivativesModule'),
  FUNDR: mod(() => import('./FundingBoardModule'), 'FundingBoardModule'),
  CARRY: mod(() => import('./FundingCarryModule'), 'FundingCarryModule'),
  LIQS: mod(() => import('./LiquidationsModule'), 'LiquidationsModule'),
  SCR: mod(() => import('./ScreenerModule'), 'ScreenerModule'),
  HEAT: mod(() => import('./HeatmapModule'), 'HeatmapModule'),
  MOV: mod(() => import('./MarketOverviewModule'), 'MarketOverviewModule'),
  CORR: mod(() => import('./CorrelationModule'), 'CorrelationModule'),
  CAL: mod(() => import('./CalendarModule'), 'CalendarModule'),
  VOL: mod(() => import('./VolatilityModule'), 'VolatilityModule'),
  MOM: mod(() => import('./MomentumModule'), 'MomentumModule'),
  SEAS: mod(() => import('./SeasonalityModule'), 'SeasonalityModule'),
  PREM: mod(() => import('./BasisModule'), 'BasisModule'),
  ARB: mod(() => import('./ArbModule'), 'ArbModule'),
  SLIP: mod(() => import('./SlippageModule'), 'SlippageModule'),
  AI: mod(() => import('./AiCopilotModule'), 'AiCopilotModule'),
  W: mod(() => import('./WatchlistModule'), 'WatchlistModule'),
  Q: mod(() => import('./QuoteMonitorModule'), 'QuoteMonitorModule'),
  PORT: mod(() => import('./PortfolioModule'), 'PortfolioModule'),
  RHEAT: mod(() => import('./PortfolioRiskModule'), 'PortfolioRiskModule'),
  ALERT: mod(() => import('./AlertsModule'), 'AlertsModule'),
  NOTE: mod(() => import('./NotesModule'), 'NotesModule'),
  RISK: mod(() => import('./RiskModule'), 'RiskModule'),
  DCA: mod(() => import('./DcaModule'), 'DcaModule'),
  LOG: mod(() => import('./JournalModule'), 'JournalModule'),
  EQ: mod(() => import('./EquityModule'), 'EquityModule'),
  PNL: mod(() => import('./PnlModule'), 'PnlModule'),
  ACCT: mod(() => import('./AccountModule'), 'AccountModule'),
  PREF: mod(() => import('./SettingsModule'), 'SettingsModule'),
  REPORT: mod(() => import('./ReportModule'), 'ReportModule'),
  N: mod(() => import('./NewsModule'), 'NewsModule'),
  HELP: mod(() => import('./HelpModule'), 'HelpModule'),
  SECF: mod(() => import('./SecurityFinderModule'), 'SecurityFinderModule'),
};
