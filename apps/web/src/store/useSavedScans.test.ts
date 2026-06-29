import { describe, it, expect, beforeEach } from 'vitest';
import { useSavedScans } from './useSavedScans';
import { ANY_CRITERIA, type ScanCriteria } from '@/lib/signals';

const crit = (over: Partial<ScanCriteria> = {}): ScanCriteria => ({ ...ANY_CRITERIA, ...over });

describe('useSavedScans', () => {
  beforeEach(() => useSavedScans.setState({ scans: [] }));

  it('saves named scans kept sorted by name, preserving their criteria', () => {
    const { save } = useSavedScans.getState();
    save('zeta', crit({ trend: 'up' }));
    save('alpha', crit({ rsi: 'oversold' }));
    expect(useSavedScans.getState().scans.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(useSavedScans.getState().scans[0].criteria.rsi).toBe('oversold');
  });

  it('overwrites a scan saved under an existing name (upsert, no duplicate)', () => {
    const { save } = useSavedScans.getState();
    save('dip', crit({ trend: 'up' }));
    save('dip', crit({ trend: 'down', minScore: 2 }));
    const { scans } = useSavedScans.getState();
    expect(scans).toHaveLength(1);
    expect(scans[0].criteria).toEqual(crit({ trend: 'down', minScore: 2 }));
  });

  it('ignores blank names and removes by name', () => {
    const { save, remove } = useSavedScans.getState();
    save('   ', crit({ trend: 'up' }));
    expect(useSavedScans.getState().scans).toHaveLength(0);
    save('keep', crit({ trend: 'up' }));
    remove('keep');
    expect(useSavedScans.getState().scans).toHaveLength(0);
  });
});
