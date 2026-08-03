import { describe, it, expect } from 'vitest';
import type { VenueScreenPoint } from '@midas/shared';
import { basisLabel, fmtDispersionBps, venuesTitle } from '@/lib/venueScreen';

const point = (exchange: string, price: number, quoteVolume: number | null): VenueScreenPoint => ({
  exchange,
  price,
  changePercent: 1,
  volume: null,
  quoteVolume,
});

describe('basisLabel', () => {
  it('distinguishes a weighted aggregate from a weaker one', () => {
    expect(basisLabel('volume-weighted')).toMatch(/volume-weighted/i);
    expect(basisLabel('median')).toMatch(/no venue reported usable volume/i);
    // The weakest claim must not read like a market-wide figure.
    expect(basisLabel('single-venue')).toMatch(/not a market aggregate/i);
    expect(basisLabel(null)).toMatch(/no venue priced/i);
  });
});

describe('fmtDispersionBps', () => {
  it('renders an unknown dispersion as unknown, not as agreement', () => {
    // Null means fewer than two venues quote it — printing 0 would claim they agree.
    expect(fmtDispersionBps(null)).toBe('—');
    expect(fmtDispersionBps(0)).toBe('<1');
  });

  it('keeps precision where it matters and drops it where it does not', () => {
    expect(fmtDispersionBps(12.34)).toBe('12.3');
    expect(fmtDispersionBps(250.6)).toBe('251');
  });
});

describe('venuesTitle', () => {
  it('names every contributing venue with its volume', () => {
    const title = venuesTitle([point('okx', 100, 5_000), point('kraken', 101, 2_500)]);
    expect(title).toContain('okx 100');
    expect(title).toContain('kraken 101');
    expect(title).toContain('5,000');
  });

  it('says volume is unavailable rather than showing a zero', () => {
    expect(venuesTitle([point('okx', 100, null)])).toContain('volume n/a');
  });

  it('handles an empty venue list', () => {
    expect(venuesTitle([])).toMatch(/no venue quoted/i);
  });
});
