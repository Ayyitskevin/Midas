import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { ApiError } from '@midas/shared';
import { config } from './config';
import { ProviderError, type DataProvider } from './providers';
import { registerRoutes } from './routes';
import { createStreamHub, registerStream } from './streaming';

/**
 * Build a fully-wired Fastify instance (routes, streaming, error handlers)
 * without starting it listening — so `index.ts` can `listen()` and tests can
 * drive it via `app.inject()`.
 */
export async function buildApp(provider: DataProvider): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  registerRoutes(app, provider);
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
