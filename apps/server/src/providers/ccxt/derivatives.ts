import type { DerivativesInfo, FundingHistoryPoint } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import { ProviderError } from '../types';
import { withProviderReceipt } from '../receipts';
import { fundingIntervalHours, readFunding, readOpenInterest, safeErrorLabel, toPerpSymbol } from './helpers';
import { finiteOrNull, sourceTimestampOrNull } from './coerce';
import { parseLiquidationRows } from './liquidations';
import type { CcxtReadContext } from './context';

// Re-exported so this module's own import sites keep working; `ccxt/context.ts`
// holds the one definition.
export type { CcxtReadContext };

const HOUR_MS = 3_600_000;

export function normalizedFieldOmission(
  label: string,
  state: 'ok' | 'unsupported' | 'error',
  fields: readonly unknown[],
): string | null {
  if (state !== 'ok') return null;
  const returned = fields.filter((field) => field !== null).length;
  const omitted = fields.length - returned;
  if (omitted === 0) return null;
  return partialEvidenceLimitation(
    `${label} observation attempted ${fields.length} evidence field(s); ${returned} returned usable evidence and ${omitted} were missing or malformed.`,
  );
}

export function fundingOmission(funding: Awaited<ReturnType<typeof readFunding>>): string | null {
  return normalizedFieldOmission('Funding', funding.state, [
    funding.fundingRate,
    funding.fundingIntervalHours,
    funding.nextFundingTime,
    funding.markPrice,
    funding.indexPrice,
  ]);
}

export function openInterestOmission(oi: Awaited<ReturnType<typeof readOpenInterest>>): string | null {
  return normalizedFieldOmission('Open-interest', oi.state, [oi.openInterest, oi.openInterestValue]);
}

/** Bundled derivatives snapshot: funding + open interest + recent liquidations. */
export async function fetchDerivatives(ctx: CcxtReadContext, symbol: string): Promise<DerivativesInfo> {
  const perp = toPerpSymbol(ctx.normalize(symbol));
  const out: DerivativesInfo = {
    symbol: perp,
    fundingRate: null,
    fundingIntervalHours: null,
    nextFundingTime: null,
    markPrice: null,
    indexPrice: null,
    openInterest: null,
    openInterestValue: null,
    recentLiquidations: [],
    timestamp: null,
  };

  const funding = await readFunding(ctx.exchange, perp);
  out.fundingRate = funding.fundingRate;
  out.fundingIntervalHours = funding.fundingIntervalHours;
  out.nextFundingTime = funding.nextFundingTime;
  out.markPrice = funding.markPrice;
  out.indexPrice = funding.indexPrice;

  const oi = await readOpenInterest(ctx.exchange, perp);
  out.openInterest = oi.openInterest;
  out.openInterestValue = oi.openInterestValue;

  let liquidationsState: 'ok' | 'unsupported' | 'error' = 'unsupported';
  let liquidationsSourceAsOf: number | null = null;
  let omittedLiquidations = 0;
  let liquidationsMalformed = false;
  if (ctx.exchange.has['fetchLiquidations']) {
    try {
      const response = await ctx.exchange.fetchLiquidations(perp, undefined, 20);
      const { recent, omitted } = parseLiquidationRows(response);
      omittedLiquidations += omitted;
      out.recentLiquidations = recent;
      liquidationsState = 'ok';
      liquidationsMalformed = (response as unknown[]).length > 0 && recent.length === 0;
      liquidationsSourceAsOf = recent.length > 0
        ? Math.max(...recent.map((liquidation) => liquidation.timestamp))
        : null;
    } catch {
      liquidationsState = 'error';
    }
  }

  const fundingHasEvidence = funding.state === 'ok' && [
    funding.fundingRate, funding.fundingIntervalHours, funding.nextFundingTime,
    funding.markPrice, funding.indexPrice,
  ].some((field) => field !== null);
  const oiHasEvidence = oi.state === 'ok' && [oi.openInterest, oi.openInterestValue].some((field) => field !== null);
  const fundingMalformed = funding.state === 'ok' && !fundingHasEvidence;
  const oiMalformed = oi.state === 'ok' && !oiHasEvidence;
  const hasSuccessfulInput =
    fundingHasEvidence || oiHasEvidence || (liquidationsState === 'ok' && !liquidationsMalformed);
  const hasFailedInput =
    funding.state === 'error' || oi.state === 'error' || liquidationsState === 'error' ||
    fundingMalformed || oiMalformed || liquidationsMalformed;
  if (hasFailedInput && !hasSuccessfulInput) {
    const category =
      (fundingMalformed || oiMalformed || liquidationsMalformed) &&
      funding.state !== 'error' && oi.state !== 'error' && liquidationsState !== 'error'
        ? 'malformed-upstream'
        : 'upstream-unavailable';
    throw new ProviderError(`${ctx.name} ${perp}: derivatives upstream read failed`, 502, perp, category);
  }
  const successfulTimestamps = [
    ...(fundingHasEvidence ? [funding.sourceAsOf] : []),
    ...(oiHasEvidence ? [oi.sourceAsOf] : []),
    ...(liquidationsState === 'ok' && !liquidationsMalformed ? [liquidationsSourceAsOf] : []),
  ];
  const allSuccessfulInputsTimestamped = successfulTimestamps.every((timestamp) => timestamp !== null);
  const sourceTimestamp =
    successfulTimestamps.length > 0 && allSuccessfulInputsTimestamped
      ? Math.min(...successfulTimestamps as number[])
      : null;
  out.timestamp = sourceTimestamp;
  const provenance = hasSuccessfulInput ? 'live' : 'unavailable';
  return withProviderReceipt(ctx, out, {
    datasetFamily: 'derivatives',
    instrument: perp,
    venue: ctx.exchangeId,
    provenance,
    sourceAsOf: sourceTimestamp,
    coverage: 'funding, open interest and recent public liquidations where supported',
    units: {
      fundingRate: 'fraction-per-interval', markPrice: 'quote-asset', indexPrice: 'quote-asset',
      openInterest: 'base-asset', openInterestValue: 'quote-asset', liquidationAmount: 'base-asset',
    },
    limitations: [
      ...(funding.state === 'unsupported'
        ? [partialEvidenceLimitation('The configured venue does not support unified funding-rate reads.')]
        : []),
      ...(funding.state === 'error'
        ? [partialEvidenceLimitation('The funding-rate upstream read failed; this snapshot is partial.')]
        : []),
      ...(fundingOmission(funding) ? [fundingOmission(funding)!] : []),
      ...(oi.state === 'unsupported'
        ? [partialEvidenceLimitation('The configured venue does not support unified open-interest reads.')]
        : []),
      ...(oi.state === 'error'
        ? [partialEvidenceLimitation('The open-interest upstream read failed; this snapshot is partial.')]
        : []),
      ...(openInterestOmission(oi) ? [openInterestOmission(oi)!] : []),
      ...(liquidationsState === 'unsupported'
        ? [partialEvidenceLimitation('The configured venue does not expose a public liquidation feed.')]
        : []),
      ...(liquidationsState === 'error'
        ? [partialEvidenceLimitation('The liquidation upstream read failed; this snapshot is partial.')]
        : []),
      ...(liquidationsMalformed
        ? [partialEvidenceLimitation('The liquidation response contained rows, but none carried complete side, price, amount, and timestamp evidence.')]
        : []),
      ...(omittedLiquidations > 0
        ? [partialEvidenceLimitation(`${omittedLiquidations} malformed liquidation rows were omitted.`)]
        : []),
    ],
    note: provenance === 'unavailable' ? 'No configured derivatives endpoint is supported by this venue.' : null,
  }, ctx.now());
}

/** Funding settlement history for a perp (fetchFundingRateHistory). */
export async function fetchFundingHistory(
  ctx: CcxtReadContext,
  symbol: string,
  limit: number,
): Promise<FundingHistoryPoint[]> {
  const perp = toPerpSymbol(ctx.normalize(symbol));
  if (!ctx.exchange.has['fetchFundingRateHistory']) return [];
  const n = Math.min(Math.max(1, Math.floor(limit)), 500);
  try {
    const response = await ctx.exchange.fetchFundingRateHistory(perp, undefined, n);
    if (!Array.isArray(response)) {
      throw new ProviderError(
        `${ctx.name} ${perp}: malformed funding-history response`,
        502,
        perp,
        'malformed-upstream',
      );
    }
    const rows = response as unknown as Array<{
      timestamp?: number;
      fundingRate?: number;
      interval?: unknown;
      fundingInterval?: unknown;
    }>;
    const valid = rows.filter(
      (row) => sourceTimestampOrNull(row.timestamp) !== null && finiteOrNull(row.fundingRate) !== null,
    );
    if (rows.length > 0 && valid.length === 0) {
      throw new ProviderError(
        `${ctx.name} ${perp}: malformed funding-history response`,
        502,
        perp,
        'malformed-upstream',
      );
    }
    const omitted = rows.length - valid.length;
    const completeness = omitted > 0
      ? partialEvidenceLimitation(
          `Funding-history read attempted ${rows.length} row(s); ${valid.length} returned usable evidence and ${omitted} were malformed and omitted.`,
        )
      : null;
    return valid
      .map((r) => {
        const time = r.timestamp as number;
        const intervalHours = fundingIntervalHours(r.interval ?? r.fundingInterval);
        const value: FundingHistoryPoint = {
          time,
          fundingRate: r.fundingRate as number,
          fundingIntervalHours: intervalHours,
        };
        return withProviderReceipt(ctx, value, {
          datasetFamily: 'funding-history', instrument: perp, venue: ctx.exchangeId,
          provenance: 'live', sourceAsOf: time,
          expectedCadenceMs: intervalHours === null ? undefined : intervalHours * HOUR_MS,
          maxAgeMs: intervalHours === null ? undefined : intervalHours * HOUR_MS * 2,
          units: { fundingRate: 'fraction-per-settlement', fundingIntervalHours: 'hours' },
          limitations: [
            ...(completeness ? [completeness] : []),
            ...(intervalHours === null
              ? [partialEvidenceLimitation('The venue omitted the funding settlement interval; annualized funding is unavailable.')]
              : []),
          ],
        }, ctx.now());
      });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`${ctx.name} ${perp}: funding-history upstream read failed (${safeErrorLabel(err)})`, 502, perp);
  }
}
