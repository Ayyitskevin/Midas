import { config } from './config';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { startAlertLoop } from './alerts/engine';
import { createNotifier } from './alerts/notify';
import { WorkspaceRepo } from './workspaces/repo';
import { PortfolioRepo } from './portfolio/repo';
import { UserRepo } from './auth/users';

async function main(): Promise<void> {
  const provider = createProvider(config.provider);
  const alertRepo = new AlertRepo(config.alertsFile);
  const userRepo = new UserRepo(config.usersFile);
  const workspaceRepo = new WorkspaceRepo(config.workspacesFile);
  const portfolioRepo = new PortfolioRepo(config.portfolioFile);
  const app = await buildApp(provider, { alertRepo, userRepo, workspaceRepo, portfolioRepo });
  if (config.authEnabled) app.log.info('auth enabled — login required');
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
