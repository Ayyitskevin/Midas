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
  version: string;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

export const config: Config = {
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '4000')),
  provider: env('MIDAS_DATA_PROVIDER', 'mock').toLowerCase(),
  corsOrigin: env('MIDAS_CORS_ORIGIN', '*'),
  aiModel: env('MIDAS_AI_MODEL', 'claude-sonnet-4-6'),
  alertsFile: env('MIDAS_ALERTS_FILE', `${env('MIDAS_DATA_DIR', './data')}/alerts.json`),
  alertIntervalMs: Number(env('MIDAS_ALERT_INTERVAL_MS', '15000')),
  version: '0.1.0',
};
