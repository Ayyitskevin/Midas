#!/usr/bin/env node
/**
 * Tiny dependency-free load test for a running Midas instance — enough to
 * answer "can this box take a beta cohort?" before inviting anyone.
 *
 *   node scripts/loadtest.mjs http://localhost:8080 [--seconds 30] [--concurrency 25]
 *
 * Mixes cheap health checks with real quote reads (the hot path a terminal
 * generates), reports throughput + latency percentiles + non-200s. Expect
 * 429s if one IP exceeds MIDAS_RATE_LIMIT_RPM — that's the limiter working.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:8080').replace(/\/$/, '');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const seconds = opt('seconds', 30);
const concurrency = opt('concurrency', 25);

const PATHS = [
  '/api/health',
  '/api/quote/BTC%2FUSDT',
  '/api/quote/ETH%2FUSDT',
  '/api/history/BTC%2FUSDT?interval=1h&range=5d',
];

const latencies = [];
const statuses = new Map();
let inFlightErrors = 0;
const deadline = Date.now() + seconds * 1000;

async function worker(id) {
  let i = id; // stagger path selection per worker
  while (Date.now() < deadline) {
    const path = PATHS[i++ % PATHS.length];
    const t0 = performance.now();
    try {
      const res = await fetch(base + path);
      await res.arrayBuffer(); // drain — latency should include the body
      latencies.push(performance.now() - t0);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    } catch {
      inFlightErrors += 1;
    }
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

console.log(`Load test → ${base}  (${seconds}s, ${concurrency} concurrent, paths: health+quotes+history)`);
const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const elapsed = (Date.now() - t0) / 1000;

latencies.sort((a, b) => a - b);
const total = latencies.length + inFlightErrors;
console.log(`\nRequests: ${total} in ${elapsed.toFixed(1)}s → ${(total / elapsed).toFixed(1)} req/s`);
console.log(
  `Latency ms: p50 ${pct(latencies, 50)?.toFixed(0)} · p95 ${pct(latencies, 95)?.toFixed(0)} · p99 ${pct(latencies, 99)?.toFixed(0)} · max ${latencies[latencies.length - 1]?.toFixed(0)}`,
);
console.log(
  `Statuses: ${[...statuses.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(' · ') || 'none'}${inFlightErrors ? ` · network-errors×${inFlightErrors}` : ''}`,
);
const bad = [...statuses.entries()].filter(([s]) => s >= 500).reduce((n, [, c]) => n + c, 0);
if (bad > 0 || inFlightErrors > 0) {
  console.error('\nServer errors under load — investigate before inviting users.');
  process.exit(1);
}
console.log('\nNo 5xx under load. (429s, if any, are the rate limiter doing its job.)');
