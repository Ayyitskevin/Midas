import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { ProviderError } from './providers';
import { safeErrorFields } from './safeLog';

describe('safe logging boundary', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reduces arbitrary failures to an allowlisted error taxonomy', () => {
    const error = new Error('apiKey=LEAK_KEY /home/private/account.json');
    error.name = 'Bad name containing LEAK_NAME';
    Object.assign(error, { code: 'TOKEN_ABC123' });
    expect(safeErrorFields(error)).toEqual({ errorType: 'Error' });
    expect(safeErrorFields({ name: 'apiKey_LEAKEDSECRET', code: 'TOKEN_ABC123' })).toEqual({
      errorType: 'Error',
    });
  });

  it('keeps secrets, user identifiers, account values, paths, and raw errors out of captured logs', async () => {
    const chunks: string[] = [];
    app = await buildApp(createProvider('mock'), {
      logger: { level: 'error', stream: { write: (message) => chunks.push(message) } },
    });
    app.get('/__privacy-error', async () => {
      const error = new Error(
        'apiKey=LEAK_KEY signature=LEAK_SIGNATURE user-123 balance=99123.45 /home/private/account.json',
      );
      error.name = 'apiKey_LEAKED_TYPE';
      Object.assign(error, { code: 'TOKEN_LEAKED_CODE' });
      throw error;
    });
    app.get('/__privacy-provider-error', async () => {
      throw new ProviderError(
        'apiKey=LEAK_PROVIDER_KEY signature=LEAK_PROVIDER_SIGNATURE /home/private/provider.json',
        502,
      );
    });
    app.get('/__privacy-cancel-unknown', async () => {
      throw new ProviderError(
        'Cancel outcome UNKNOWN apiKey=LEAK_CANCEL_KEY /home/private/cancel.json',
        502,
        undefined,
        'upstream-unavailable',
        'cancel-outcome-unknown',
      );
    });

    const unexpected = await app.inject({
      method: 'GET',
      url: '/__privacy-error?token=LEAK_QUERY_TOKEN',
      headers: {
        authorization: 'Bearer LEAK_AUTH_TOKEN',
        cookie: 'session=LEAK_COOKIE',
      },
    });
    const providerFailure = await app.inject({ method: 'GET', url: '/__privacy-provider-error' });
    const cancelUnknown = await app.inject({ method: 'GET', url: '/__privacy-cancel-unknown' });
    const missing = await app.inject({
      method: 'GET',
      url: '/__missing?token=LEAK_NOT_FOUND_TOKEN',
    });
    app.log.error(
      {
        apiKey: 'LEAK_STRUCTURED_KEY',
        userId: 'user-structured',
        credentials: { secret: 'LEAK_NESTED_SECRET' },
        err: new Error('LEAK_NESTED_ERROR'),
      },
      'redaction guard probe',
    );

    const snapshot = chunks.join('');
    expect(unexpected.json()).toEqual({
      error: 'InternalServerError',
      message: 'Internal Server Error',
      statusCode: 500,
    });
    expect(providerFailure.json()).toEqual({
      error: 'ProviderError',
      message: 'Internal Server Error',
      statusCode: 502,
    });
    expect(cancelUnknown.json()).toEqual({
      error: 'ProviderError',
      message:
        'Cancel outcome UNKNOWN — the exchange did not confirm the result. Check the exchange for the true order state before assuming it is open or canceled.',
      statusCode: 502,
    });
    expect(cancelUnknown.body).not.toMatch(/LEAK_CANCEL_KEY|\/home\/private|apiKey=/);
    expect(missing.json()).toEqual({
      error: 'NotFound',
      message: 'Route not found',
      statusCode: 404,
    });
    expect(snapshot).toContain('request failed');
    expect(snapshot).toContain('redaction guard probe');
    expect(snapshot).toContain('[REDACTED]');
    for (const forbidden of [
      'LEAK_KEY',
      'LEAK_SIGNATURE',
      'LEAK_AUTH_TOKEN',
      'LEAK_COOKIE',
      'LEAK_QUERY_TOKEN',
      'LEAK_STRUCTURED_KEY',
      'LEAK_NESTED_SECRET',
      'LEAK_NESTED_ERROR',
      'LEAKED_TYPE',
      'LEAKED_CODE',
      'LEAK_PROVIDER_KEY',
      'LEAK_PROVIDER_SIGNATURE',
      'LEAK_NOT_FOUND_TOKEN',
      'LEAK_CANCEL_KEY',
      'user-123',
      'user-structured',
      '99123.45',
      '/home/private',
      '127.0.0.1',
    ]) {
      expect(snapshot).not.toContain(forbidden);
    }
  });
});
