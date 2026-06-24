import type { ComponentType } from 'react';
import type { ModuleCode } from './meta';
import type { ModuleProps } from './types';
import { DescriptionModule } from './DescriptionModule';
import { ChartModule } from './ChartModule';
import { OrderBookModule } from './OrderBookModule';
import { TradesModule } from './TradesModule';
import { MultiExchangeModule } from './MultiExchangeModule';
import { DerivativesModule } from './DerivativesModule';
import { ScreenerModule } from './ScreenerModule';
import { HeatmapModule } from './HeatmapModule';
import { AiCopilotModule } from './AiCopilotModule';
import { WatchlistModule } from './WatchlistModule';
import { QuoteMonitorModule } from './QuoteMonitorModule';
import { PortfolioModule } from './PortfolioModule';
import { AlertsModule } from './AlertsModule';
import { NewsModule } from './NewsModule';
import { HelpModule } from './HelpModule';
import { SecurityFinderModule } from './SecurityFinderModule';

/** Maps a module code to the React component that renders it inside a panel. */
export const MODULE_COMPONENTS: Record<ModuleCode, ComponentType<ModuleProps>> = {
  DES: DescriptionModule,
  GP: ChartModule,
  BOOK: OrderBookModule,
  TAS: TradesModule,
  ALLQ: MultiExchangeModule,
  FUND: DerivativesModule,
  SCR: ScreenerModule,
  HEAT: HeatmapModule,
  AI: AiCopilotModule,
  W: WatchlistModule,
  Q: QuoteMonitorModule,
  PORT: PortfolioModule,
  ALERT: AlertsModule,
  N: NewsModule,
  HELP: HelpModule,
  SECF: SecurityFinderModule,
};
