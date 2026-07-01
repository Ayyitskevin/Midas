import { config } from './config';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { startAlertLoop } from './alerts/engine';
import { createNotifier } from './alerts/notify';
import { startAccountWatch } from './accountWatch';
import { ccxtKeysConfigured } from './providers/balances';
import { postWebhookText } from './webhook';
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

  const app = await buildApp(provider, {
    alertRepo,
    userRepo,
    workspaceRepo,
    portfolioRepo,
    watchlistRepo,
    notesRepo,
    accountWatch,
  });
  if (config.authEnabled) app.log.info('auth enabled — login required');
  if (accountWatch) {
    app.log.info(
      { intervalMs: Math.max(2000, config.accountWatchMs) },
      'account watcher running — fill notifications on',
    );
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
  });
  if (config.alertWebhook) app.log.info('alert webhook delivery enabled');

  startAlertLoop(
    alertRepo,
    provider,
    config.alertIntervalMs,
    (fired) => {
      app.log.info({ count: fired.length }, 'alert(s) fired');
      void notifier.deliver(fired);
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
