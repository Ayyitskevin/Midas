/** Runtime configuration, read once from the environment at startup. */

export interface Config {
  host: string;
  port: number;
  /** Active data provider id: 'mock' | 'yahoo' | 'ccxt'. */
  provider: string;
  corsOrigin: string;
  /** Claude model used by the AI copilot. */
  aiModel: string;
  /** JSON file backing the server-side alert store. */
  alertsFile: string;
  /** How often the background alert loop evaluates, in ms. */
  alertIntervalMs: number;
  /** Optional outbound webhook URL fired triggers are POSTed to (Discord/Slack/custom). */
  alertWebhook: string;
  /** Require login for the API + terminal. Off by default (single-user). */
  authEnabled: boolean;
  /** Allow new accounts to register (the first user can always bootstrap). */
  authAllowSignup: boolean;
  /** HMAC secret for session tokens (a random one is used if unset). */
  authSecret: string;
  /** JSON file backing the user store. */
  usersFile: string;
  /** JSON file backing the per-user workspace snapshot store. */
  workspacesFile: string;
  /** JSON file backing the per-user portfolio snapshot store. */
  portfolioFile: string;
  /** JSON file backing the per-user watchlist snapshot store. */
  watchlistsFile: string;
  /** JSON file backing the per-user notes snapshot store. */
  notesFile: string;
  /** Master switch for LIVE order placement. Off by default — opt-in only. */
  tradingEnabled: boolean;
  /** Allow trading without auth on a trusted host (escape hatch; default off). */
  tradingAllowNoAuth: boolean;
  /** Hard per-order USD notional cap the server enforces (0 = uncapped). */
  maxOrderUsd: number;
  /** Cumulative UTC-day USD notional cap across all orders (0 = uncapped). */
  maxDailyUsd: number;
  /** How often the account watcher polls open orders for fill events, in ms (0 = off). */
  accountWatchMs: number;
  /** Operator digest cadence in hours (0 = off). Needs MIDAS_ALERT_WEBHOOK. */
  digestHours: number;
  /** Account equity snapshot cadence in ms (0 = off; default hourly). */
  equitySnapMs: number;
  /** JSON file backing the equity snapshot series. */
  equityFile: string;
  /** MIDAS_DEMO_MODE — public-demo posture: mock data, no trading, no signup. */
  demoMode: boolean;
  /** Secret that encrypts per-user exchange keys at rest ('' = feature off). */
  keysKmsSecret: string;
  /** JSON file backing the per-user key store. */
  keysFile: string;
  /** Per-IP request ceiling in requests/minute (0 = off; demo mode defaults to 120). */
  rateLimitRpm: number;
  /** Keyed users allowed to run per-user background loops (watcher/equity). */
  maxKeyedUsers: number;
  version: string;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Demo-mode posture: one flag that makes an instance safe to expose as a
 * public demo, no matter what else the environment says — synthetic data
 * only, live trading impossible, no account signups. Pure and applied last,
 * so a stray MIDAS_TRADING_ENABLED=true on a demo box cannot win.
 */
export function applyDemoMode(cfg: Config): Config {
  if (!cfg.demoMode) return cfg;
  return {
    ...cfg,
    provider: 'mock',
    tradingEnabled: false,
    tradingAllowNoAuth: false,
    authAllowSignup: false,
    // A public box gets a request ceiling even when the operator forgot one.
    rateLimitRpm: cfg.rateLimitRpm > 0 ? cfg.rateLimitRpm : 120,
  };
}

const baseConfig: Config = {
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '4000')),
  provider: env('MIDAS_DATA_PROVIDER', 'mock').toLowerCase(),
  corsOrigin: env('MIDAS_CORS_ORIGIN', '*'),
  aiModel: env('MIDAS_AI_MODEL', 'claude-sonnet-4-6'),
  alertsFile: env('MIDAS_ALERTS_FILE', `${env('MIDAS_DATA_DIR', './data')}/alerts.json`),
  alertIntervalMs: Number(env('MIDAS_ALERT_INTERVAL_MS', '15000')),
  alertWebhook: env('MIDAS_ALERT_WEBHOOK', ''),
  authEnabled: env('MIDAS_AUTH_ENABLED', 'false').toLowerCase() === 'true',
  authAllowSignup: env('MIDAS_AUTH_ALLOW_SIGNUP', 'true').toLowerCase() === 'true',
  authSecret: env('MIDAS_AUTH_SECRET', ''),
  usersFile: env('MIDAS_USERS_FILE', `${env('MIDAS_DATA_DIR', './data')}/users.json`),
  workspacesFile: env(
    'MIDAS_WORKSPACES_FILE',
    `${env('MIDAS_DATA_DIR', './data')}/workspaces.json`,
  ),
  portfolioFile: env(
    'MIDAS_PORTFOLIO_FILE',
    `${env('MIDAS_DATA_DIR', './data')}/portfolio.json`,
  ),
  watchlistsFile: env(
    'MIDAS_WATCHLISTS_FILE',
    `${env('MIDAS_DATA_DIR', './data')}/watchlists.json`,
  ),
  notesFile: env('MIDAS_NOTES_FILE', `${env('MIDAS_DATA_DIR', './data')}/notes.json`),
  tradingEnabled: env('MIDAS_TRADING_ENABLED', 'false').toLowerCase() === 'true',
  tradingAllowNoAuth: env('MIDAS_TRADING_ALLOW_NO_AUTH', 'false').toLowerCase() === 'true',
  maxOrderUsd: Number(env('MIDAS_MAX_ORDER_USD', '1000')),
  maxDailyUsd: Number(env('MIDAS_MAX_DAILY_USD', '5000')),
  accountWatchMs: Number(env('MIDAS_ACCOUNT_WATCH_MS', '10000')),
  digestHours: Number(env('MIDAS_DIGEST_HOURS', '0')),
  equitySnapMs: Number(env('MIDAS_EQUITY_SNAP_MS', '3600000')),
  equityFile: env('MIDAS_EQUITY_FILE', `${env('MIDAS_DATA_DIR', './data')}/equity.json`),
  demoMode: env('MIDAS_DEMO_MODE', 'false').toLowerCase() === 'true',
  keysKmsSecret: env('MIDAS_KEYS_KMS_SECRET', ''),
  keysFile: env('MIDAS_KEYS_FILE', `${env('MIDAS_DATA_DIR', './data')}/user-keys.json`),
  rateLimitRpm: Number(env('MIDAS_RATE_LIMIT_RPM', '0')),
  maxKeyedUsers: Number(env('MIDAS_MAX_KEYED_USERS', '25')),
  version: '0.5.0',
};

export const config: Config = applyDemoMode(baseConfig);
