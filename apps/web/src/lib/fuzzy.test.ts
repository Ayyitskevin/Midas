import { describe, it, expect } from 'vitest';
import { fuzzyScore, rankByFuzzy } from '@/lib/fuzzy';

describe('fuzzyScore', () => {
  it('matches a subsequence and rejects a non-subsequence', () => {
    expect(fuzzyScore('gp', 'GP')).not.toBeNull();
    expect(fuzzyScore('crl', 'Correlation')).not.toBeNull(); // c..r..l
    expect(fuzzyScore('xyz', 'GP')).toBeNull();
    expect(fuzzyScore('gpp', 'GP')).toBeNull(); // longer than target
  });

  it('is case-insensitive and scores empty query as 0', () => {
    expect(fuzzyScore('CO', 'correlation')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('rewards contiguous, start-anchored matches over scattered ones', () => {
    const contiguous = fuzzyScore('co', 'correlation')!;
    const scattered = fuzzyScore('cn', 'correlation')!; // c..n (last char)
    expect(contiguous).toBeGreaterThan(scattered);
  });
});

describe('rankByFuzzy', () => {
  const items = [
    { code: 'CORR', aliases: ['COR', 'CORREL'], title: 'Correlation Matrix' },
    { code: 'GP', aliases: ['CHART', 'G'], title: 'Price Graph' },
    { code: 'PORT', aliases: ['POS'], title: 'Portfolio' },
  ];
  const keys = (c: (typeof items)[number]) => [c.code, ...c.aliases, c.title];

  it('ranks the best match first', () => {
    expect(rankByFuzzy('cor', items, keys)[0].code).toBe('CORR');
    expect(rankByFuzzy('chart', items, keys)[0].code).toBe('GP');
    expect(rankByFuzzy('graph', items, keys)[0].code).toBe('GP');
  });

  it('drops non-matches', () => {
    const out = rankByFuzzy('zzz', items, keys);
    expect(out).toEqual([]);
  });

  it('returns the list unchanged for an empty query', () => {
    expect(rankByFuzzy('', items, keys)).toEqual(items);
    expect(rankByFuzzy('   ', items, keys)).toEqual(items);
  });
});
