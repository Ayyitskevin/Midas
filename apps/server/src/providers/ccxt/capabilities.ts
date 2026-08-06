import type { ProviderCapabilityManifest } from '@midas/shared';
import { buildProviderCapabilities, type CapabilityDefinition } from '../receipts';

export const CCXT_PROVIDER_VERSION = '1.0.0';

function ccxtCapability(input: Partial<CapabilityDefinition> & Pick<CapabilityDefinition, 'method' | 'support' | 'auth' | 'mode' | 'coverage'>): CapabilityDefinition {
  return {
    venue: null,
    expectedCadenceMs: null,
    maxAgeMs: null,
    cacheTtlMs: null,
    methodology: null,
    caveats: [],
    ...input,
  };
}

/**
 * Assemble the ccxt provider's capability manifest. Output must stay
 * byte-identical across refactors — conformance.test.ts and the capabilities
 * snapshots pin every entry, order, value and condition.
 */
export function buildCcxtCapabilities(input: {
  id: string;
  name: string;
  keyed: boolean;
  has: Record<string, unknown>;
}): ProviderCapabilityManifest {
  const { id, name, keyed, has } = input;
  const runtimeMode = (supported: boolean): 'live' | 'unavailable' => supported ? 'live' : 'unavailable';
  const conditional = (
    method: string,
    supported: boolean,
    coverage: string,
    expectedCadenceMs: number,
    maxAgeMs: number,
    caveats: string[] = [],
  ): CapabilityDefinition =>
    ccxtCapability({
      method,
      support: 'conditional',
      auth: 'public',
      mode: runtimeMode(supported),
      venue: id,
      coverage,
      expectedCadenceMs,
      maxAgeMs,
      caveats,
    });
  const account = (method: string, supported: boolean, coverage: string): CapabilityDefinition =>
    ccxtCapability({
      method,
      support: 'conditional',
      auth: 'credentials-required',
      mode: runtimeMode(keyed && supported),
      venue: id,
      coverage,
      expectedCadenceMs: 15_000,
      maxAgeMs: 60_000,
      caveats: [
        ...(keyed ? [] : ['Read-only exchange credentials are not configured for this provider instance.']),
        'Account snapshot endpoints may omit an authoritative source timestamp; receipt freshness is unknown when omitted.',
      ],
    });
  return buildProviderCapabilities({
    providerId: 'ccxt',
    providerVersion: CCXT_PROVIDER_VERSION,
    source: name,
    capabilities: {
      quote: ccxtCapability({ method: 'getQuote', support: 'supported', auth: 'public', mode: 'live', venue: id, coverage: 'configured exchange markets', expectedCadenceMs: 5_000, maxAgeMs: 30_000, caveats: ['Ticker timestamps are venue-dependent and may be absent.'] }),
      history: conditional('getHistory', Boolean(has['fetchOHLCV']), 'configured exchange OHLCV/timeframes', 60_000, 300_000),
      funding: conditional('getDerivatives', Boolean(has['fetchFundingRate']), 'funding projection from configured-exchange derivatives snapshot', 60_000, 300_000),
      'funding-history': conditional('getFundingHistory', Boolean(has['fetchFundingRateHistory']), 'configured exchange funding settlements', 28_800_000, 57_600_000),
      'open-interest': conditional('getDerivatives', Boolean(has['fetchOpenInterest']), 'OI projection from configured-exchange derivatives snapshot', 60_000, 300_000),
      'open-interest-history': conditional('getOiDelta', Boolean(has['fetchOpenInterestHistory']), 'configured exchange OI history', 300_000, 28_800_000),
      'open-interest-delta': conditional('getOiDelta', Boolean(has['fetchOpenInterestHistory']), '1h, 4h, 24h and 7d aligned OI/price windows', 300_000, 28_800_000),
      derivatives: conditional('getDerivatives', Boolean(has['fetchFundingRate'] || has['fetchOpenInterest'] || has['fetchLiquidations']), 'bundled funding, OI and liquidation snapshot', 60_000, 300_000),
      'venue-derivatives': ccxtCapability({ method: 'getVenueDerivatives', support: 'conditional', auth: 'public', mode: 'live', coverage: 'configured public compare-exchange set', expectedCadenceMs: 60_000, maxAgeMs: 300_000, caveats: ['Each venue independently exposes funding/OI fields; partial rows are possible.'] }),
      liquidations: conditional('liquidationsProvenance|getDerivatives', Boolean(has['fetchLiquidations']), 'recent public liquidation events', 1_000, 60_000, ['Many exchanges expose no public feed or throttle it, so observed events can undercount the market.']),
      'venue-screener': ccxtCapability({ method: 'getVenueScreen', support: 'conditional', auth: 'public', mode: 'live', coverage: 'whole ticker set per configured compare venue', expectedCadenceMs: 5_000, maxAgeMs: 60_000, caveats: ['Exchange-reported 24h volume is widely documented as inflated; treat it as a scale signal, not a verified total.', 'A venue that fails is reported as reduced coverage rather than failing the board.'] }),
      'venue-quotes': ccxtCapability({ method: 'getExchangeQuotes', support: 'conditional', auth: 'public', mode: 'live', coverage: 'configured public compare-exchange set', expectedCadenceMs: 5_000, maxAgeMs: 30_000, caveats: ['Venue failures are represented by partial coverage rather than fabricated quotes.'] }),
      'venue-arbitrage': ccxtCapability({ method: 'getExchangeQuotes', support: 'conditional', auth: 'public', mode: 'live', coverage: 'derived from contemporaneous executable venue quotes', expectedCadenceMs: 5_000, maxAgeMs: 30_000, methodology: { id: 'midas.venue-arbitrage-top-of-book', version: '1.0', formula: 'grossBps = (bestBid - bestAsk) / bestAsk * 10000; netBps = grossBps - referenceTakerFeesBps' }, caveats: ['Actionability additionally requires known fees, top-of-book size and bounded timestamp skew.'] }),
      options: ccxtCapability({ method: 'getDvol|getFuturesTermStructure|getOptionsChain', support: 'conditional', auth: 'public', mode: 'live', source: 'ccxt:deribit', venue: 'deribit', coverage: 'Deribit BTC/ETH public options, DVOL and dated futures', expectedCadenceMs: 60_000, maxAgeMs: 300_000, caveats: ['Options availability depends on the installed ccxt Deribit public methods and listed instruments.'] }),
      balances: account('getBalances', Boolean(has['fetchBalance']), 'configured exchange account balances'),
      'account-orders': account('getOpenOrders', Boolean(has['fetchOpenOrders']), 'configured exchange resting orders'),
      'account-positions': account('getPositions', Boolean(has['fetchPositions']), 'configured exchange open positions'),
      'account-fills': account('getFills', Boolean(has['fetchMyTrades']), 'configured exchange recent fills'),
    },
  });
}
