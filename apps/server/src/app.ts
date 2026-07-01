import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { ApiError, SystemStatus } from '@midas/shared';
import { config } from './config';
import { ProviderError, type DataProvider } from './providers';
import { registerRoutes } from './routes';
import { createStreamHub, registerStream } from './streaming';
import { AlertRepo } from './alerts/repo';
import { registerAlertRoutes } from './alerts/routes';
import { WorkspaceRepo } from './workspaces/repo';
import { PortfolioRepo } from './portfolio/repo';
import { WatchlistRepo } from './watchlists/repo';
import { NotesRepo } from './notes/repo';
import { registerSnapshotRoutes } from './snapshots/routes';
import { UserRepo } from './auth/users';
import { registerAuthRoutes, type AuthDeps } from './auth/routes';
import { installAuthGuard } from './auth/guard';
import { registerAccountEventsRoute, type AccountWatchHandle } from './accountWatch';
import { registerEquityRoute, type EquityRepo } from './equity';
import { KeyRepo } from './keys/repo';
import { registerKeyRoutes } from './keys/routes';
import { createProviderPool } from './keys/pool';
import { CcxtProvider } from './providers/ccxt';
import { createRateLimiter } from './rateLimit';

export interface BuildAppOptions {
  /** Alert store; defaults to an in-memory repo (tests). index.ts injects a file-backed one. */
  alertRepo?: AlertRepo;
  /** Per-user workspace snapshot store; defaults to in-memory (tests). */
  workspaceRepo?: WorkspaceRepo;
  /** Per-user portfolio snapshot store; defaults to in-memory (tests). */
  portfolioRepo?: PortfolioRepo;
  /** Per-user watchlist snapshot store; defaults to in-memory (tests). */
  watchlistRepo?: WatchlistRepo;
  /** Per-user notes snapshot store; defaults to in-memory (tests). */
  notesRepo?: NotesRepo;
  /** User store; defaults to an in-memory repo (tests). */
  userRepo?: UserRepo;
  /** Auth overrides (tests); falls back to config. */
  auth?: { enabled?: boolean; allowSignup?: boolean; secret?: string };
  /** Account order watcher (index.ts starts one when keyed + live); null/omitted = off. */
  accountWatch?: AccountWatchHandle | null;
  /** Equity snapshot store + whether its loop runs; null/omitted = off. */
  accountEquity?: { repo: EquityRepo; watching: boolean } | null;
  /** Live operational self-description (index.ts injects the real loop states). */
  systemInfo?: () => SystemStatus;
  /** Per-user exchange key store; null = feature off, omitted = derive from config. */
  keyRepo?: KeyRepo | null;
}

/**
 * Build a fully-wired Fastify instance (routes, streaming, error handlers)
 * without starting it listening — so `index.ts` can `listen()` and tests can
 * drive it via `app.inject()`.
 */
export async function buildApp(
  provider: DataProvider,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  // Baseline security headers on every HTTP response. The API serves JSON
  // (the web bundle is a separate origin/container), so refusing MIME
  // sniffing and framing costs nothing and closes whole bug classes.
  app.addHook('onSend', async (_req, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
  });

  // Per-IP request ceiling for public surfaces (demo mode defaults this on).
  // /api/health stays exempt so uptime monitors never trip it.
  if (config.rateLimitRpm > 0) {
    const limiter = createRateLimiter(60_000, config.rateLimitRpm);
    app.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/api/health')) return;
      const waitMs = limiter.check(req.ip, Date.now());
      if (waitMs != null) {
        return reply
          .code(429)
          .header('retry-after', String(Math.ceil(waitMs / 1000)))
          .send({
            error: 'TooManyRequests',
            message: `Rate limit reached — try again in ${Math.ceil(waitMs / 1000)}s.`,
            statusCode: 429,
          });
      }
    });
  }

  const authDeps: AuthDeps = {
    enabled: opts.auth?.enabled ?? config.authEnabled,
    allowSignup: opts.auth?.allowSignup ?? config.authAllowSignup,
    secret: opts.auth?.secret || config.authSecret || randomBytes(32).toString('hex'),
    users: opts.userRepo ?? new UserRepo(),
  };
  installAuthGuard(app, authDeps); // guards /api/* (except public) when enabled
  registerAuthRoutes(app, authDeps);

  // Per-user exchange keys (hosted-tier groundwork): encrypted store + a
  // provider pool that resolves account READS to the requesting user's own
  // exchange client. Trading stays pinned to the base provider + operator
  // gates until per-user trading ships behind its own review.
  const keyRepo =
    opts.keyRepo !== undefined
      ? opts.keyRepo
      : config.keysKmsSecret
        ? new KeyRepo(config.keysKmsSecret)
        : null;
  const pool = createProviderPool({
    base: provider,
    repo: keyRepo,
    factory: (k) =>
      new CcxtProvider({ exchange: k.exchange, apiKey: k.apiKey, secret: k.secret, password: k.password }),
  });

  registerRoutes(app, provider, pool);
  registerKeyRoutes(app, { repo: keyRepo, onChanged: (userId) => pool.invalidate(userId) });
  registerAccountEventsRoute(app, opts.accountWatch ?? null);
  registerEquityRoute(app, opts.accountEquity ?? null);

  // Operational self-description (SYS panel). Defaults are the honest "no
  // background loops" answer; index.ts injects the real states.
  const startedAt = Date.now();
  const systemInfo =
    opts.systemInfo ??
    ((): SystemStatus => ({
      provider: provider.name,
      live: provider.live,
      demo: config.demoMode,
      version: config.version,
      startedAt,
      accountWatch: { on: false, intervalMs: null },
      streamNudge: false,
      digest: { on: false, hours: null },
      equity: { on: false, intervalMs: null },
      tradingEnabled: config.tradingEnabled,
      authEnabled: authDeps.enabled,
    }));
  app.get('/api/system', async () => systemInfo());
  registerAlertRoutes(app, opts.alertRepo ?? new AlertRepo());
  registerSnapshotRoutes(app, opts.workspaceRepo ?? new WorkspaceRepo(), '/api/workspaces');
  registerSnapshotRoutes(app, opts.portfolioRepo ?? new PortfolioRepo(), '/api/portfolio');
  registerSnapshotRoutes(app, opts.watchlistRepo ?? new WatchlistRepo(), '/api/watchlists');
  registerSnapshotRoutes(app, opts.notesRepo ?? new NotesRepo(), '/api/notes');
  registerStream(app, createStreamHub(provider));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode =
      error instanceof ProviderError
        ? error.statusCode
        : typeof error.statusCode === 'number'
          ? error.statusCode
          : 500;
    request.log.error(error);
    const body: ApiError = {
      error: error.name || 'Error',
      message: error.message || 'Internal Server Error',
      statusCode,
    };
    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      error: 'NotFound',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    };
    reply.status(404).send(body);
  });

  return app;
}
