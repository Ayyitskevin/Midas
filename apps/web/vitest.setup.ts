/**
 * The web stores persist via `window.localStorage`, which the `node` test
 * environment doesn't provide. Install a minimal in-memory shim (and a `window`
 * that exposes it) before any store module loads, so persistence behaves
 * predictably and zustand stops warning that storage is unavailable.
 */
const store = new Map<string, string>();

const localStorageShim = {
  getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string): void => void store.set(key, String(value)),
  removeItem: (key: string): void => void store.delete(key),
  clear: (): void => store.clear(),
  key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
  get length(): number {
    return store.size;
  },
};

const g = globalThis as Record<string, unknown>;
if (!('localStorage' in g)) g.localStorage = localStorageShim;
// zustand's default persist storage reads `window.localStorage` specifically.
if (!('window' in g)) g.window = { localStorage: localStorageShim };
