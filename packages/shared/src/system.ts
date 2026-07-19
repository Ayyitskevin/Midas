/**
 * Server/system metadata — the release version, the SYS self-description, and
 * the API envelopes (error + health). Part of the @midas/shared data contract
 * (re-exported from index.ts).
 */

/**
 * The Midas release version — the single place it is defined. The server
 * reports it at /api/health, the static demo mirrors it, and the web app's
 * update toast compares against it.
 */
export const MIDAS_VERSION = '0.5.0';

/**
 * Operational self-description: which background capabilities this server is
 * actually running. Powers the SYS panel — the honest answer to "is the
 * watcher on? is anything streaming? what version is this?" without reading
 * server logs.
 */
export interface SystemStatus {
  provider: string;
  live: boolean;
  demo: boolean;
  version: string;
  /** Epoch millis the server process started (uptime = now - startedAt). */
  startedAt: number;
  accountWatch: { on: boolean; intervalMs: number | null };
  /** Whether a ccxt.pro order stream is nudging the watcher. */
  streamNudge: boolean;
  digest: { on: boolean; hours: number | null };
  equity: { on: boolean; intervalMs: number | null };
  /** Legacy field; false while the execution safety hold is authoritative. */
  tradingEnabled: boolean;
  authEnabled: boolean;
}

/** Standard error body returned by the API on failure. */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/** Metadata about the running server, surfaced at /api/health. */
export interface HealthResponse {
  status: 'ok';
  provider: string;
  /** Whether the active provider reaches a live upstream or returns synthetic data. */
  live: boolean;
  /**
   * Whether the WebSocket stream delivers real upstream data (CCXT Pro) rather
   * than the synthetic random-walk fallback used for non-ccxt providers. Kept
   * separate from `live` because they diverge: yahoo has live REST quotes
   * (`live: true`) but no live stream (`streamLive: false`), so the client can
   * label a streaming panel honestly instead of showing "LIVE" over synthetic prints.
   */
  streamLive: boolean;
  time: number;
  version: string;
  /** True when the server runs in public-demo posture (mock data, no trading, no signup). */
  demo?: boolean;
}
