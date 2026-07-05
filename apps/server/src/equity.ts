import { existsSync, readFileSync } from 'node:fs';
import type { AccountEquityResponse, AccountPositions, Balances, EquityPoint } from '@midas/shared';
import { writeFileAtomic } from './persist';
import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';

/**
 * Account equity curve — periodic snapshots of real account value, persisted
 * server-side so the series survives restarts and accrues with no browser
 * open. Read-only observation: it reuses the same balance/position reads the
 * BAL/POSN panels make and never calls anything else.
 */

const POINT_CAP = 5000; // ~208 days of hourly snapshots

/** File-backed (or in-memory for tests) bounded series of equity points. */
export class EquityRepo {
  private pts: EquityPoint[] = [];

  constructor(private readonly file?: string) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { points?: EquityPoint[] };
      if (Array.isArray(data.points)) this.pts = data.points;
    } catch {
      /* corrupt store → start fresh */
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      writeFileAtomic(this.file, JSON.stringify({ points: this.pts }));
    } catch {
      /* best-effort */
    }
  }

  add(point: EquityPoint): void {
    this.pts = [...this.pts, point].slice(-POINT_CAP);
    this.persist();
  }

  points(): EquityPoint[] {
    return this.pts;
  }
}

/**
 * Turn one pair of account reads into an equity point — or null when the
 * account is not honestly readable (no keys / provider error): a gap in the
 * series is truthful, a synthetic point is not. Pure.
 */
export function composeEquityPoint(
  balances: Balances,
  positions: AccountPositions,
  at: number,
): EquityPoint | null {
  if (balances.provenance !== 'live' || balances.totalValueUsd == null) return null;
  return {
    at,
    totalUsd: balances.totalValueUsd,
    unrealizedPnlUsd: positions.provenance === 'live' ? positions.totalUnrealizedPnlUsd : null,
  };
}

export interface EquityLoop {
  stop(): void;
}

/** Snapshot on a timer (alert-loop shape: in-flight guard, unref'd interval). */
export function startEquityLoop(
  repo: EquityRepo,
  provider: DataProvider,
  intervalMs: number,
  onError?: (err: unknown) => void,
  now: () => number = Date.now,
): EquityLoop {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const [balances, positions] = await Promise.all([provider.getBalances(), provider.getPositions()]);
      const point = composeEquityPoint(balances, positions, now());
      if (point) repo.add(point);
    } catch (err) {
      onError?.(err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Resolves whose equity series a request sees. `keyed` is true when the user
 * has stored their own exchange keys — a keyed user only ever sees THEIR
 * series (or an honest "not running"), never the operator's.
 */
export type UserEquityResolver = (userId: string) => {
  keyed: boolean;
  repo: EquityRepo | null;
};

/** GET /api/account/equity — registered even when off, so the answer is honest. */
export function registerEquityRoute(
  app: FastifyInstance,
  deps: { repo: EquityRepo; watching: boolean } | null,
  userEquity?: UserEquityResolver,
): void {
  app.get('/api/account/equity', async (req): Promise<AccountEquityResponse> => {
    const ue = req.userId && userEquity ? userEquity(req.userId) : null;
    if (ue?.keyed) {
      // Isolation: a keyed user's curve is their own snapshots or honestly
      // off — the operator's account curve is never shown to them.
      if (!ue.repo) {
        return {
          watching: false,
          note:
            'Per-user equity snapshots are not running for your keys — they need MIDAS_EQUITY_SNAP_MS > 0 ' +
            'and a free slot under MIDAS_MAX_KEYED_USERS (ask the operator).',
          points: [],
        };
      }
      return { watching: true, note: null, points: ue.repo.points() };
    }

    if (!deps || !deps.watching) {
      return {
        watching: false,
        note:
          'Equity snapshots are off — they run when MIDAS_EQUITY_SNAP_MS > 0 (default hourly), ' +
          'the ccxt provider is active, and exchange API keys are configured.',
        points: deps?.repo.points() ?? [],
      };
    }
    return { watching: true, note: null, points: deps.repo.points() };
  });
}
