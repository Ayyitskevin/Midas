import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { ApiError, SystemStatus } from '@midas/shared';
import { config } from './config';
import { ProviderError, type DataProvider } from './providers';
import { registerRoutes } from './routes';
import { MAX_STREAM_FRAME_BYTES, createStreamHub, registerStream } from './streaming';
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
import { dirname, join } from 'node:path';
import { registerAccountEventsRoute, type AccountWatchHandle } from './accountWatch';
import { registerEquityRoute, type EquityRepo } from './equity';
import { KeyRepo, type UserExchangeKeys } from './keys/repo';
import { registerKeyRoutes } from './keys/routes';
import { createProviderPool } from './keys/pool';
import { createUserLoops, userEquityFileName, type UserLoops } from './keys/loops';
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
  /** Trusted reverse-proxy hop count (tests); falls back to config.trustProxy. */
  trustProxy?: number;
  /** Account order watcher (index.ts starts one when keyed + live); null/omitted = off. */
  accountWatch?: AccountWatchHandle | null;
  /** Equity snapshot store + whether its loop runs; null/omitted = off. */
  accountEquity?: { repo: EquityRepo; watching: boolean } | null;
  /** Live operational self-description (index.ts injects the real loop states). */
  systemInfo?: () => SystemStatus;
  /** Per-user exchange key store; null = feature off, omitted = derive from config. */
  keyRepo?: KeyRepo | null;
  /** Builds a per-user provider from decrypted creds (tests inject a stub). */
  keyProviderFactory?: (keys: UserExchangeKeys) => DataProvider;
  /** Per-user loop manager override (tests); omitted = derive when keys are on. */
  userLoops?: UserLoops | null;
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
    // Fastify's default, made explicit: no request body may exceed 1 MiB.
    // The biggest legitimate payloads (workspace/portfolio snapshots) sit
    // well under this; everything larger is an honest 413, not an allocation.
    bodyLimit: 1024 * 1024,
    // Derive req.ip from X-Forwarded-For ONLY when behind a known number of
    // trusted proxy hops (config.trustProxy, default 0). Otherwise every per-IP
    // control (login throttle, signup/ai/chat limiters, global limiter) sees the
    // proxy's IP for every client and collapses to one shared bucket. Trusting a
    // fixed hop count is spoof-resistant: a client's own forged X-Forwarded-For
    // is discarded. Left 0 (default) for a directly-exposed server so a client
    // can't forge its req.ip; the shipped docker-compose sets it to 1 (nginx).
    trustProxy: (opts.trustProxy ?? config.trustProxy) > 0 ? (opts.trustProxy ?? config.trustProxy) : false,
  });

  await app.register(cors, { origin: config.corsOrigin });
  // Cap WS frames at the protocol layer. /api/stream is public even with auth
  // on, and a real subscribe message is ~70 bytes; without this, ws defaults to
  // buffering up to 100 MiB per frame into the heap BEFORE the app-level check
  // runs — an unauthenticated OOM on the most exposed edge. maxPayload rejects
  // an oversized frame before it is buffered.
  await app.register(websocket, { options: { maxPayload: MAX_STREAM_FRAME_BYTES } });

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
  // A weak fixed secret is worse than none: an unset secret gets a strong
  // random one per boot (tokens just don't survive a restart), but a short
  // operator-supplied MIDAS_AUTH_SECRET produces a brute-forceable HMAC key
  // that DOES persist. Warn loudly rather than accept it silently.
  const MIN_AUTH_SECRET = 16;
  if (authDeps.enabled && !opts.auth?.secret && config.authSecret && config.authSecret.length < MIN_AUTH_SECRET) {
    app.log.warn(
      `MIDAS_AUTH_SECRET is only ${config.authSecret.length} characters — use at least ${MIN_AUTH_SECRET} (e.g. \`openssl rand -hex 32\`). A short secret weakens every session token.`,
    );
  }
  installAuthGuard(app, authDeps); // guards /api/* (except public) when enabled
  registerAuthRoutes(app, authDeps);

  // Per-user exchange keys (hosted-tier): encrypted store + a provider pool
  // that resolves authenticated account reads only to the requesting user's
  // own exchange client. No usable user key means honestly unavailable —
  // never an operator-account fallback.
  const keyRepo =
    opts.keyRepo !== undefined
      ? opts.keyRepo
      : config.keysKmsSecret
        ? new KeyRepo(config.keysKmsSecret)
        : null;
  if (keyRepo && !authDeps.enabled) {
    throw new Error(
      'Per-user exchange keys require authentication. Set MIDAS_AUTH_ENABLED=true or remove MIDAS_KEYS_KMS_SECRET.',
    );
  }
  const pool = createProviderPool({
    base: provider,
    repo: keyRepo,
    factory:
      opts.keyProviderFactory ??
      ((k) =>
        new CcxtProvider({ exchange: k.exchange, apiKey: k.apiKey, secret: k.secret, password: k.password })),
  });

  // Per-user background loops: each keyed user gets their own account watcher
  // + equity snapshots against THEIR client (never the base provider), capped
  // by MIDAS_MAX_KEYED_USERS. Existing keyed users start at boot; key writes
  // start/rebuild a user's set, key deletes stop it.
  const userLoops =
    opts.userLoops !== undefined
      ? opts.userLoops
      : keyRepo && (config.accountWatchMs > 0 || config.equitySnapMs > 0)
        ? createUserLoops({
            repo: keyRepo,
            pool,
            watchMs: config.accountWatchMs > 0 ? Math.max(2000, config.accountWatchMs) : 0,
            equityMs: config.equitySnapMs > 0 ? Math.max(60_000, config.equitySnapMs) : 0,
            equityFileFor: (userId) => join(dirname(config.equityFile), userEquityFileName(userId)),
            maxUsers: config.maxKeyedUsers,
            onError: (userId, err) => app.log.error({ err, userId }, 'per-user loop error'),
            onRefused: (userId) =>
              app.log.warn({ userId, cap: config.maxKeyedUsers }, 'keyed-user cap reached — no loops for this user'),
          })
        : null;
  if (userLoops && keyRepo) {
    for (const userId of keyRepo.userIds()) userLoops.ensure(userId);
    if (userLoops.size() > 0) app.log.info({ users: userLoops.size() }, 'per-user account loops running');
  }

  registerRoutes(app, provider, pool, (userId) => keyRepo?.metaFor(userId) ?? null);
  registerKeyRoutes(app, {
    repo: keyRepo,
    onChanged: (userId) => {
      pool.invalidate(userId);
      userLoops?.ensure(userId);
    },
  });
  // The keyed-user resolvers exist whenever the key store does — even with
  // loops off — so a keyed user gets an honest "not running" answer rather
  // than falling through to the operator's feed/curve.
  const keyedFor = (userId: string): boolean => keyRepo?.metaFor(userId) != null;
  registerAccountEventsRoute(
    app,
    opts.accountWatch ?? null,
    keyRepo
      ? (userId) => ({ configured: keyedFor(userId), watch: userLoops?.watcherFor(userId) ?? null })
      : undefined,
  );
  registerEquityRoute(
    app,
    opts.accountEquity ?? null,
    keyRepo
      ? (userId) => ({ configured: keyedFor(userId), repo: userLoops?.equityRepoFor(userId) ?? null })
      : undefined,
  );

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
      // Legacy MIDAS_TRADING_ENABLED is not execution authority while held.
      tradingEnabled: false,
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
    const isProvider = error instanceof ProviderError;
    const statusCode = isProvider
      ? error.statusCode
      : typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    request.log.error(error);
    // Only echo the error's own message when it is a deliberate, client-safe
    // error: a ProviderError (already sanitized via describe()/safeErrorLabel)
    // or any <500 (e.g. Fastify validation). An unexpected 5xx carries a raw
    // internal message — a stack string, or a ccxt error embedding the signed
    // request URL (HMAC signature / API key) — and must never reach the client.
    const clientSafe = isProvider || statusCode < 500;
    const body: ApiError = {
      error: error.name || 'Error',
      message: clientSafe ? error.message || 'Error' : 'Internal Server Error',
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
