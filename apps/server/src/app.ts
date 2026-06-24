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
import { UserRepo } from './auth/users';
import { registerAuthRoutes, type AuthDeps } from './auth/routes';
import { installAuthGuard } from './auth/guard';

export interface BuildAppOptions {
  /** Alert store; defaults to an in-memory repo (tests). index.ts injects a file-backed one. */
  alertRepo?: AlertRepo;
  /** User store; defaults to an in-memory repo (tests). */
  userRepo?: UserRepo;
  /** Auth overrides (tests); falls back to config. */
  auth?: { enabled?: boolean; allowSignup?: boolean; secret?: string };
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

  const authDeps: AuthDeps = {
    enabled: opts.auth?.enabled ?? config.authEnabled,
    allowSignup: opts.auth?.allowSignup ?? config.authAllowSignup,
    secret: opts.auth?.secret || config.authSecret || randomBytes(32).toString('hex'),
    users: opts.userRepo ?? new UserRepo(),
  };
  installAuthGuard(app, authDeps); // guards /api/* (except public) when enabled
  registerAuthRoutes(app, authDeps);

  registerRoutes(app, provider);
  registerAlertRoutes(app, opts.alertRepo ?? new AlertRepo());
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
