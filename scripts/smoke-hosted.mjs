#!/usr/bin/env node
/**
 * Smoke-test a hosted Midas instance before you invite anyone.
 *
 *   node scripts/smoke-hosted.mjs [baseUrl] [--user U --pass P]
 *
 * baseUrl defaults to http://localhost:8080 (the docker `web` origin). With a
 * login it verifies the three things a paying, key-storing user must be able to
 * trust on day one:
 *
 *   1. Auth is enforced — protected routes reject requests with no token.
 *   2. Per-user exchange keys are write-only — the API never echoes a stored
 *      secret back, and a keyless user's account reads are honestly
 *      `unavailable` (never the operator's account).
 *   3. Execution is safety-held — order placement returns 503, unconditionally.
 *
 * Pass your own operator login (created during setup) with --user/--pass (or the
 * SMOKE_USER / SMOKE_PASS env vars) to run the full suite. Without a login it
 * runs the unauthenticated checks only and tells you what it skipped. It never
 * creates an account (so it can't accidentally claim the first-user admin slot),
 * and it deletes the throwaway key it stores.
 *
 * Exit 0 = all green. Non-zero = something a user must not see — do not invite.
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const base = (args.find((a) => !a.startsWith('--') && a !== flag('--user') && a !== flag('--pass')) ??
  'http://localhost:8080').replace(/\/$/, '');
const user = flag('--user') ?? process.env.SMOKE_USER;
const pass = flag('--pass') ?? process.env.SMOKE_PASS;

let pass_ = 0;
let warn_ = 0;
let fail_ = 0;
const ok = (m) => { pass_++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const warn = (m) => { warn_++; console.log(`  \x1b[33m!\x1b[0m ${m}`); };
const bad = (m) => { fail_++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
  return { status: res.status, text, json };
}

async function main() {
  console.log(`\nMidas hosted smoke test → ${base}\n`);

  // 1. Health.
  const health = await req('GET', '/api/health');
  if (health.status === 200 && health.json?.status === 'ok') {
    ok(`health ok — provider=${health.json.provider} live=${health.json.live} demo=${!!health.json.demo} v${health.json.version}`);
    if (health.json.demo) warn('server reports demo:true — this is a public demo posture, not a paid instance');
  } else {
    bad(`GET /api/health returned ${health.status} (is the instance up at ${base}?)`);
    return finish();
  }

  // 2. Auth posture.
  const status = await req('GET', '/api/auth/status');
  const authOn = status.json?.enabled === true;
  if (authOn) ok(`auth enabled (allowSignup=${!!status.json.allowSignup})`);
  else warn('auth is DISABLED — a hosted, key-storing instance should set MIDAS_AUTH_ENABLED=true');

  // 3. With auth on, a protected route must reject an anonymous request.
  if (authOn) {
    const anon = await req('GET', '/api/balances');
    if (anon.status === 401) ok('protected route rejects anonymous request (401)');
    else bad(`GET /api/balances with no token returned ${anon.status}, expected 401 — auth guard is not covering account reads`);
  }

  // 4. Authenticated suite (needs an operator login).
  let token;
  if (authOn) {
    if (!user || !pass) {
      warn('no --user/--pass (or SMOKE_USER/SMOKE_PASS) given — skipping key-secrecy + safety-hold checks. Re-run with your operator login for the full suite.');
    } else {
      const login = await req('POST', '/api/auth/login', { body: { username: user, password: pass } });
      if (login.status === 200 && login.json?.token) { token = login.json.token; ok(`logged in as ${user}`); }
      else bad(`login as ${user} failed (${login.status}) — check the credentials`);
    }
  }

  if (token) {
    // Keyless account read must be honestly unavailable, never the operator's book.
    const bal = await req('GET', '/api/balances', { token });
    if (bal.json?.provenance === 'unavailable' && bal.json?.source === 'per-user-keys') {
      ok("keyless account read is 'unavailable' + isolated (no operator fallback)");
    } else if (bal.json?.provenance) {
      warn(`account read provenance='${bal.json.provenance}' source='${bal.json.source}' — expected unavailable/per-user-keys (is MIDAS_KEYS_KMS_SECRET set?)`);
    } else {
      bad(`GET /api/balances returned ${bal.status} — unexpected`);
    }

    // Per-user keys: enabled? then secrecy round-trip.
    const keys0 = await req('GET', '/api/account/keys', { token });
    if (keys0.status === 501) {
      warn('per-user keys are OFF (no MIDAS_KEYS_KMS_SECRET) — the paid "bring your own read-only key" feature is disabled');
    } else if (keys0.status === 200) {
      const marker = `SMOKESECRET_${Math.random().toString(36).slice(2)}`;
      const put = await req('PUT', '/api/account/keys', {
        token,
        body: { exchange: 'binance', apiKey: `SMOKEKEY_${marker}`, secret: marker, canTrade: false },
      });
      if (put.status === 200 && put.json?.keyLast4) {
        ok(`stored a throwaway key (meta only: exchange=${put.json.exchange} last4=${put.json.keyLast4} canTrade=${put.json.canTrade})`);
        const get = await req('GET', '/api/account/keys', { token });
        if (get.text.includes(marker)) bad('SECRET LEAK — GET /api/account/keys echoed the stored secret back. Do not invite users.');
        else ok('stored secret is never returned by the API (write-only keys confirmed)');
        const del = await req('DELETE', '/api/account/keys', { token });
        if (del.status === 200) ok('throwaway key deleted (cleanup)');
        else warn(`cleanup DELETE returned ${del.status} — remove the smoke key manually`);
      } else {
        bad(`PUT /api/account/keys returned ${put.status} — could not exercise key storage`);
      }
    } else {
      warn(`GET /api/account/keys returned ${keys0.status} — unexpected`);
    }

    // Execution safety hold — the load-bearing "we are not a brokerage" guarantee.
    const order = await req('POST', '/api/orders', {
      token,
      body: { symbol: 'BTC/USDT', side: 'buy', type: 'market', amount: 0.001 },
    });
    if (order.status === 503) ok('execution is safety-held (POST /api/orders → 503)');
    else bad(`POST /api/orders returned ${order.status}, expected 503 — execution is NOT held. Stop and investigate.`);
  }

  // 5. Trading status hold reason (visible once authed, or anon when auth off).
  const ts = await req('GET', '/api/trading/status', { token });
  if (ts.json && ts.json.enabled === false) ok(`trading/status reports enabled=false ("${(ts.json.reason ?? '').slice(0, 48)}…")`);
  else if (ts.status === 401 && authOn && !token) warn('trading/status needs a login to inspect — skipped');
  else if (ts.json) bad(`trading/status reports enabled=${ts.json.enabled} — execution hold is not being advertised`);

  return finish();
}

function finish() {
  console.log(`\n${pass_} passed, ${warn_} warned, ${fail_} failed\n`);
  if (fail_ > 0) { console.log('\x1b[31mNOT ready to invite users — resolve the failures above.\x1b[0m\n'); process.exit(1); }
  if (warn_ > 0) console.log('\x1b[33mGreen, with warnings to review.\x1b[0m\n');
  else console.log('\x1b[32mAll green — the hosted security posture is intact.\x1b[0m\n');
  process.exit(0);
}

main().catch((err) => { console.error(`\nsmoke test crashed: ${err?.message ?? err}\n`); process.exit(2); });
