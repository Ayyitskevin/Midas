import type { DataProvider } from './types';
import { MockProvider } from './mock';
import { YahooProvider } from './yahoo';
import { CcxtProvider } from './ccxt';

export type { DataProvider, HistoryOptions, ProviderPublicErrorCode } from './types';
export { ProviderError } from './types';

/**
 * Construct the data provider selected by configuration.
 * Unknown ids fail closed so a misspelling can never silently switch live
 * deployments onto synthetic market data.
 */
export function createProvider(name: string): DataProvider {
  switch (name) {
    case 'yahoo':
      return new YahooProvider();
    case 'ccxt':
      return new CcxtProvider();
    case 'mock':
      return new MockProvider();
    default:
      throw new Error(`Unknown data provider "${name}". Expected yahoo, ccxt, or mock.`);
  }
}
