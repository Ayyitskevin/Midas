import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';
import { registerMarketRoutes } from './routes/market';
import { registerSolanaRoutes } from './routes/solana';
import {
  PER_USER_ACCOUNT_STATUS_SOURCE,
  registerAccountRoutes,
} from './routes/account';
import { registerAiRoutes } from './routes/ai';
import type { ProviderResolver, KeyMetaLookup } from './routes/shared';
import { createDataStatusTracker, registerDataStatusRoute } from './dataStatus';

// The route table is split by domain under ./routes; this module is the
// composition root that wires the groups together. The resolver/lookup types
// are re-exported so the public import surface (`from './routes'`) is unchanged.
export type { ProviderResolver, KeyMetaLookup } from './routes/shared';

/** Register all Midas API routes against the given provider. */
export function registerRoutes(
  app: FastifyInstance,
  provider: DataProvider,
  pool: ProviderResolver = { accountFor: () => provider, userFor: () => null },
  _keyMeta: KeyMetaLookup = () => null,
): void {
  const dataStatus = createDataStatusTracker(Date.now, (observation) => {
    if (observation.kind === 'receipt') {
      app.log.debug(
        {
          receiptId: observation.receiptId,
          datasetFamily: observation.datasetFamily,
          providerId: observation.providerId,
          traceId: observation.traceId,
          freshness: observation.freshness,
          cache: observation.cache,
        },
        'data receipt',
      );
      return;
    }
    app.log.warn(
      {
        datasetFamily: observation.datasetFamily,
        providerId: observation.providerId,
        errorCategory: observation.errorCategory,
      },
      'data receipt error',
    );
  });
  registerMarketRoutes(app, provider, dataStatus);
  registerSolanaRoutes(app, provider);
  registerAccountRoutes(app, pool, dataStatus, PER_USER_ACCOUNT_STATUS_SOURCE);
  registerDataStatusRoute(app, provider, pool, dataStatus, PER_USER_ACCOUNT_STATUS_SOURCE);
  registerAiRoutes(app, provider);
}
