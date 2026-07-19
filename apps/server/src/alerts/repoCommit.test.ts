import { describe, it, expect } from 'vitest';
import type { Alert } from '@midas/shared';
import { AlertRepo } from './repo';

const NOW = 1_700_000_000_000;
const input = (symbol: string) => ({ symbol, metric: 'price' as const, op: 'above' as const, value: 100, repeat: false });

describe('AlertRepo.commit merges by id (evaluation-race safety)', () => {
  it('keeps create/delete/edit that landed during the evaluation await, and still applies eval fields', () => {
    const repo = new AlertRepo();
    const a = repo.create(input('BTC/USDT'), NOW);
    const b = repo.create(input('ETH/USDT'), NOW); // "deleted during the gap"

    // The snapshot the engine takes BEFORE its awaited provider reads.
    const snapshot: Alert[] = repo.all().map((x) => ({ ...x }));

    // --- concurrent user actions during the async gap ---
    const c = repo.create(input('SOL/USDT'), NOW); // created after the snapshot
    repo.updateFor(a.id, { enabled: false }); // user disables A
    repo.removeFor(b.id); // user deletes B

    // Engine commits a STALE `next` derived from the snapshot: it "fired" A.
    const next: Alert[] = snapshot.map((x) =>
      x.id === a.id ? { ...x, status: 'triggered' as const, triggeredAt: NOW, lastValue: 123 } : x,
    );
    repo.commit(next, []);

    const byId = new Map(repo.all().map((x) => [x.id, x]));
    // A: the concurrent disable is preserved AND the evaluation fields land.
    expect(byId.get(a.id)?.enabled).toBe(false);
    expect(byId.get(a.id)?.status).toBe('triggered');
    expect(byId.get(a.id)?.lastValue).toBe(123);
    // B: deleted during the gap stays deleted (the stale snapshot must not resurrect it).
    expect(byId.has(b.id)).toBe(false);
    // C: created during the gap survives (the stale snapshot must not drop it).
    expect(byId.has(c.id)).toBe(true);
  });
});
