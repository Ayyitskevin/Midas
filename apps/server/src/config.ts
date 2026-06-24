/** Runtime configuration, read once from the environment at startup. */

export interface Config {
  host: string;
  port: number;
  /** Active data provider id: 'mock' | 'yahoo'. */
  provider: string;
  corsOrigin: string;
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
  version: '0.1.0',
};
