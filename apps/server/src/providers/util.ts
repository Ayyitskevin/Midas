import type { Interval, Range } from '@midas/shared';

/** FNV-1a string hash → 32-bit unsigned int. Stable across runs. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — a small, fast, deterministic PRNG seeded by a 32-bit int. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a PRNG seeded by an arbitrary list of parts (strings or numbers). */
export function seeded(...parts: Array<string | number>): () => number {
  return mulberry32(hashString(parts.join('|')));
}

/** Standard-normal sample via Box–Muller, driven by the given PRNG. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Uniform sample in [min, max). */
export function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60,
  '2m': 120,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
  '90m': 5400,
  '1d': 86400,
  '1wk': 604800,
  '1mo': 2592000,
};

export const RANGE_SECONDS: Record<Range, number> = {
  '1d': 86400,
  '5d': 432000,
  '1mo': 2592000,
  '3mo': 7776000,
  '6mo': 15552000,
  '1y': 31536000,
  '2y': 63072000,
  '5y': 157680000,
  max: 315360000,
};

/**
 * Rough US-equity market state from the current instant, using UTC hours as a
 * stand-in for Eastern trading hours. Good enough for synthetic data and a
 * sensible default when an upstream doesn't report state.
 */
export function usMarketState(now = Date.now()): 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' {
  const d = new Date(now);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return 'CLOSED';
  // Eastern ≈ UTC-4/-5; approximate regular session 13:30–20:00 UTC.
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutes >= 13 * 60 + 30 && minutes < 20 * 60) return 'REGULAR';
  if (minutes >= 8 * 60 && minutes < 13 * 60 + 30) return 'PRE';
  if (minutes >= 20 * 60 && minutes < 24 * 60) return 'POST';
  return 'CLOSED';
}
