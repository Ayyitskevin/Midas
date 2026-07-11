import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';
import { registerMarketRoutes } from './routes/market';
import { registerSolanaRoutes } from './routes/solana';
import { registerAccountRoutes } from './routes/account';
import { registerAiRoutes } from './routes/ai';
import type { ProviderResolver, KeyMetaLookup } from './routes/shared';

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
  registerMarketRoutes(app, provider);
  registerSolanaRoutes(app, provider);
  registerAccountRoutes(app, pool);
  registerAiRoutes(app, provider);
}
