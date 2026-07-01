import type { TradingStatus } from '@midas/shared';
import { api } from './api';
import { useFetch } from './hooks';

/**
 * Poll the server's live-trading capability. Used anywhere the UI must be
 * honest about LIVE vs preview mode (status bar badge, order ticket, order
 * cancel affordances). Null until the first response arrives.
 */
export function useTradingStatus(intervalMs = 60_000): TradingStatus | null {
  const { data } = useFetch((signal) => api.tradingStatus(signal), [], { intervalMs });
  return data;
}
