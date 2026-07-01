import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { ApiError } from '@midas/shared';
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

  const authDeps: AuthDeps = {
    enabled: opts.auth?.enabled ?? config.authEnabled,
    allowSignup: opts.auth?.allowSignup ?? config.authAllowSignup,
    secret: opts.auth?.secret || config.authSecret || randomBytes(32).toString('hex'),
    users: opts.userRepo ?? new UserRepo(),
  };
  installAuthGuard(app, authDeps); // guards /api/* (except public) when enabled
  registerAuthRoutes(app, authDeps);

  registerRoutes(app, provider);
  registerAccountEventsRoute(app, opts.accountWatch ?? null);
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
