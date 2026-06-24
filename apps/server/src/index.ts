import { config } from './config';
import { createProvider } from './providers';
import { buildApp } from './app';

async function main(): Promise<void> {
  const provider = createProvider(config.provider);
  const app = await buildApp(provider);
  app.log.info(
    { provider: provider.name, live: provider.live },
    `Midas server using "${provider.name}" data provider`,
  );

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
