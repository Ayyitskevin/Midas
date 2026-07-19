import { config } from './config';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { startAlertLoop } from './alerts/engine';
import { createNotifier } from './alerts/notify';
import { createNudgeDebouncer, startAccountWatch } from './accountWatch';
import { ccxtKeysConfigured } from './providers/balances';
import { postWebhookText } from './webhook';
import { createDigestSource, startDigestLoop } from './digest';
import { EquityRepo, startEquityLoop } from './equity';
import { KeyRepo } from './keys/repo';
import { WorkspaceRepo } from './workspaces/repo';
import { PortfolioRepo } from './portfolio/repo';
import { WatchlistRepo } from './watchlists/repo';
import { NotesRepo } from './notes/repo';
import { UserRepo } from './auth/users';

async function main(): Promise<void> {
  const provider = createProvider(config.provider);
  const alertRepo = new AlertRepo(config.alertsFile);
  const userRepo = new UserRepo(config.usersFile);
  const workspaceRepo = new WorkspaceRepo(config.workspacesFile);
  const portfolioRepo = new PortfolioRepo(config.portfolioFile);
  const watchlistRepo = new WatchlistRepo(config.watchlistsFile);
  const notesRepo = new NotesRepo(config.notesFile);

  // Account order watcher: read-only fill notifications. Only worth running
  // against a live keyed provider; the interval is floored at 2s so a typo'd
  // env value can't hammer the exchange. Errors are logged once `app` exists —
  // the first tick can't fire before then (interval ≥ 2000ms).
  const watchEnabled = config.accountWatchMs > 0 && provider.live && ccxtKeysConfigured();
  const accountWatch = watchEnabled
    ? startAccountWatch({
        provider,
        intervalMs: Math.max(2000, config.accountWatchMs),
        notify: (text) => postWebhookText(config.alertWebhook, text),
        onError: (err) => app.log.error(err, 'account watcher error'),
      })
    : null;

  // Equity snapshots share the watcher's gating: only a keyed live account
  // yields honest points. The repo is file-backed so the curve accrues
  // across restarts.
  const equityEnabled = config.equitySnapMs > 0 && provider.live && ccxtKeysConfigured();
  const accountEquity = equityEnabled
    ? { repo: new EquityRepo(config.equityFile), watching: true }
    : null;

  // Per-user exchange keys (encrypted at rest) — file-backed so they survive
  // restarts; off entirely until the operator sets the KMS secret.
  const keyRepo = config.keysKmsSecret ? new KeyRepo(config.keysKmsSecret, config.keysFile) : null;

  // Filled in as the loops start below; the SYS route reads them at request time.
  let nudgeActive = false;
  const serverStartedAt = Date.now();

  const app = await buildApp(provider, {
    alertRepo,
    userRepo,
    workspaceRepo,
    portfolioRepo,
    watchlistRepo,
    notesRepo,
    accountWatch,
    accountEquity,
    keyRepo,
    systemInfo: () => ({
      provider: provider.name,
      live: provider.live,
      demo: config.demoMode,
      version: config.version,
      startedAt: serverStartedAt,
      accountWatch: {
        on: accountWatch != null,
        intervalMs: accountWatch ? Math.max(2000, config.accountWatchMs) : null,
      },
      streamNudge: nudgeActive,
      digest: {
        on: config.digestHours > 0 && Boolean(config.alertWebhook),
        hours: config.digestHours > 0 ? Math.max(1, config.digestHours) : null,
      },
      equity: {
        on: accountEquity != null,
        intervalMs: accountEquity ? Math.max(60_000, config.equitySnapMs) : null,
      },
      // Legacy MIDAS_TRADING_ENABLED is not execution authority while held.
      tradingEnabled: false,
      authEnabled: config.authEnabled,
    }),
  });
  if (config.authEnabled) app.log.info('auth enabled — login required');
  if (keyRepo) app.log.info('per-user exchange keys enabled (encrypted at rest)');
  if (config.rateLimitRpm > 0) app.log.info({ rpm: config.rateLimitRpm }, 'rate limiting on');
  if (accountWatch) {
    app.log.info(
      { intervalMs: Math.max(2000, config.accountWatchMs) },
      'account watcher running — fill notifications on',
    );
    // Where the venue streams order updates (ccxt.pro), use them as a NUDGE:
    // poll immediately instead of waiting out the interval. REST stays the
    // source of truth, so a dead stream just degrades to plain polling.
    const stopNudge = provider.streamAccountNudge?.(
      createNudgeDebouncer(() => void accountWatch.tick()),
    );
    if (stopNudge) {
      nudgeActive = true;
      app.log.info('account stream nudge active (ccxt.pro watchOrders)');
    }
  }
  if (accountEquity) {
    const snapMs = Math.max(60_000, config.equitySnapMs); // floor: once a minute
    startEquityLoop(accountEquity.repo, provider, snapMs, (err) =>
      app.log.error(err, 'equity snapshot error'),
    );
    app.log.info({ intervalMs: snapMs }, 'equity snapshots running');
  }
  app.log.info(
    { provider: provider.name, live: provider.live },
    `Midas server using "${provider.name}" data provider`,
  );

  // Evaluate alerts in the background and deliver fires out-of-band (webhook),
  // so they reach the user even with no browser open.
  const notifier = createNotifier({
    webhookUrl: config.alertWebhook,
    onError: (err) => app.log.error(err, 'alert webhook delivery failed'),
    // On a non-live provider (mock/dev) price/change/funding alerts fire on
    // synthetic data — mark deliveries so a webhook consumer never reads a
    // mock-fired alert as a live-market signal.
    synthetic: !provider.live,
  });
  if (config.alertWebhook) app.log.info('alert webhook delivery enabled');

  // Operator digest: a periodic webhook summary — daily P&L recap (equity,
  // fills, movers) + alerts fired + order flow observed since the last one.
  // Opt-in and pointless without a webhook. The recap reads only run against
  // a keyed live provider; otherwise those sections are honestly omitted.
  const accountReadable = provider.live && ccxtKeysConfigured();
  const digest =
    config.digestHours > 0 && config.alertWebhook
      ? createDigestSource({
          providerName: provider.name,
          providerLive: provider.live,
          version: config.version,
          watcher: accountWatch,
          accountProvider: accountReadable ? provider : null,
          equityPoints: accountEquity ? () => accountEquity.repo.points() : null,
        })
      : null;
  if (digest) {
    const hours = Math.max(1, config.digestHours); // floor: never spammier than hourly
    startDigestLoop(
      digest,
      hours * 3_600_000,
      (text) => postWebhookText(config.alertWebhook, text),
      (err) => app.log.error(err, 'digest error'),
    );
    app.log.info({ hours }, 'operator digest enabled');
  }

  startAlertLoop(
    alertRepo,
    provider,
    config.alertIntervalMs,
    (fired) => {
      app.log.info({ count: fired.length }, 'alert(s) fired');
      void notifier.deliver(fired);
      digest?.addAlertFires(fired.length);
    },
    (err) => app.log.error(err, 'alert loop error'),
  );

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
