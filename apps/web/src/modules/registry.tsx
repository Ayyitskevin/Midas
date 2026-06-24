import type { ComponentType } from 'react';
import type { ModuleCode } from './meta';
import type { ModuleProps } from './types';
import { DescriptionModule } from './DescriptionModule';
import { ChartModule } from './ChartModule';
import { WatchlistModule } from './WatchlistModule';
import { QuoteMonitorModule } from './QuoteMonitorModule';
import { NewsModule } from './NewsModule';
import { HelpModule } from './HelpModule';
import { SecurityFinderModule } from './SecurityFinderModule';

/** Maps a module code to the React component that renders it inside a panel. */
export const MODULE_COMPONENTS: Record<ModuleCode, ComponentType<ModuleProps>> = {
  DES: DescriptionModule,
  GP: ChartModule,
  W: WatchlistModule,
  Q: QuoteMonitorModule,
  N: NewsModule,
  HELP: HelpModule,
  SECF: SecurityFinderModule,
};
