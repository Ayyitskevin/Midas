import type { DataProvider } from './types';
import { MockProvider } from './mock';
import { YahooProvider } from './yahoo';

export type { DataProvider, HistoryOptions } from './types';
export { ProviderError } from './types';

/**
 * Construct the data provider selected by configuration.
 * Unknown ids fall back to the always-available mock provider.
 */
export function createProvider(name: string): DataProvider {
  switch (name) {
    case 'yahoo':
      return new YahooProvider();
    case 'mock':
      return new MockProvider();
    default:
      // eslint-disable-next-line no-console
      console.warn(`[midas] unknown provider "${name}", falling back to "mock"`);
      return new MockProvider();
  }
}
