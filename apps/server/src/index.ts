import { config } from './config';
import { createProvider } from './providers';
import { buildApp } from './app';
import { AlertRepo } from './alerts/repo';
import { startAlertLoop } from './alerts/engine';

async function main(): Promise<void> {
  const provider = createProvider(config.provider);
  const alertRepo = new AlertRepo(config.alertsFile);
  const app = await buildApp(provider, { alertRepo });
  app.log.info(
    { provider: provider.name, live: provider.live },
    `Midas server using "${provider.name}" data provider`,
  );

  // Evaluate alerts in the background so they fire even with no browser open.
  startAlertLoop(
    alertRepo,
    provider,
    config.alertIntervalMs,
    (fired) => app.log.info({ count: fired.length }, 'alert(s) fired'),
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
