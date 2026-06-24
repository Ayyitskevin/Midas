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
  BOOK: mod(() => import('./OrderBookModule'), 'OrderBookModule'),
  TAS: mod(() => import('./TradesModule'), 'TradesModule'),
  ALLQ: mod(() => import('./MultiExchangeModule'), 'MultiExchangeModule'),
  FUND: mod(() => import('./DerivativesModule'), 'DerivativesModule'),
  SCR: mod(() => import('./ScreenerModule'), 'ScreenerModule'),
  HEAT: mod(() => import('./HeatmapModule'), 'HeatmapModule'),
  MOV: mod(() => import('./MarketOverviewModule'), 'MarketOverviewModule'),
  CORR: mod(() => import('./CorrelationModule'), 'CorrelationModule'),
  AI: mod(() => import('./AiCopilotModule'), 'AiCopilotModule'),
  W: mod(() => import('./WatchlistModule'), 'WatchlistModule'),
  Q: mod(() => import('./QuoteMonitorModule'), 'QuoteMonitorModule'),
  PORT: mod(() => import('./PortfolioModule'), 'PortfolioModule'),
  ALERT: mod(() => import('./AlertsModule'), 'AlertsModule'),
  N: mod(() => import('./NewsModule'), 'NewsModule'),
  HELP: mod(() => import('./HelpModule'), 'HelpModule'),
  SECF: mod(() => import('./SecurityFinderModule'), 'SecurityFinderModule'),
};
