import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type { AccountWebhookFailureCategory } from '@midas/shared';
import type { ResolvedWebhookTarget } from './url';

export const USER_WEBHOOK_TIMEOUT_MS = 5_000;
export const MAX_USER_WEBHOOK_PAYLOAD_BYTES = 16 * 1024;

export interface UserWebhookTransportResponse {
  statusCode: number | null;
}

export interface UserWebhookTransport {
  post(
    target: ResolvedWebhookTarget,
    body: string,
    deliveryId: string,
  ): Promise<UserWebhookTransportResponse>;
}

export interface UserWebhookRequestHandle {
  once(event: 'error', listener: () => void): unknown;
  destroy(): void;
  end(body: string): void;
}

export interface UserWebhookResponseHandle {
  statusCode?: number;
  destroy(): void;
}

export type UserWebhookRequestFactory = (
  options: RequestOptions,
  onResponse: (response: UserWebhookResponseHandle) => void,
) => UserWebhookRequestHandle;

const defaultRequestFactory: UserWebhookRequestFactory = (options, onResponse) =>
  httpsRequest(options, onResponse);

export class UserWebhookTransportError extends Error {
  override readonly name = 'UserWebhookTransportError';

  constructor(readonly category: Extract<AccountWebhookFailureCategory, 'timeout' | 'network' | 'malformed-response'>) {
    super('Personal webhook delivery failed.');
  }
}

/**
 * HTTPS-only, address-pinned transport. Node's low-level request API does not
 * follow redirects. Connecting directly to the validated address while using
 * the original hostname for Host/TLS SNI prevents a second, attacker-steered
 * DNS lookup between validation and connection.
 */
export class PinnedHttpsWebhookTransport implements UserWebhookTransport {
  constructor(
    private readonly requestFactory: UserWebhookRequestFactory = defaultRequestFactory,
    private readonly timeoutMs = USER_WEBHOOK_TIMEOUT_MS,
  ) {}

  async post(
    target: ResolvedWebhookTarget,
    body: string,
    deliveryId: string,
  ): Promise<UserWebhookTransportResponse> {
    const bytes = Buffer.byteLength(body);
    if (bytes <= 0 || bytes > MAX_USER_WEBHOOK_PAYLOAD_BYTES) {
      throw new UserWebhookTransportError('malformed-response');
    }

    return new Promise<UserWebhookTransportResponse>((resolve, reject) => {
      let timedOut = false;
      let settled = false;
      let hardTimeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (hardTimeout) clearTimeout(hardTimeout);
        fn();
      };
      const req = this.requestFactory(
        {
          protocol: 'https:',
          hostname: target.address,
          family: target.family,
          port: 443,
          method: 'POST',
          path: `${target.url.pathname}${target.url.search}`,
          // No shared socket can carry a later job to a different resolved
          // target; every delivery is one bounded connection.
          agent: false,
          servername: isIP(target.hostname) ? undefined : target.hostname,
          maxHeaderSize: 8 * 1024,
          headers: {
            host: target.url.host,
            'content-type': 'application/json',
            accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
            'content-length': String(bytes),
            'x-midas-delivery-id': deliveryId,
          },
        },
        (res) => {
          const statusCode = res.statusCode;
          // The response body is never needed and may contain hostile/private
          // text. Close after the bounded header parse instead of buffering or
          // logging it.
          res.destroy();
          if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
            finish(() => reject(new UserWebhookTransportError('malformed-response')));
            return;
          }
          finish(() => resolve({ statusCode }));
        },
      );
      // ClientRequest.setTimeout is only an inactivity timeout; a hostile peer
      // can trickle TLS/header bytes forever. This is an absolute deadline from
      // request creation through the response headers.
      hardTimeout = setTimeout(() => {
        timedOut = true;
        req.destroy();
        finish(() => reject(new UserWebhookTransportError('timeout')));
      }, this.timeoutMs);
      hardTimeout.unref?.();
      req.once('error', () => {
        finish(() => reject(new UserWebhookTransportError(timedOut ? 'timeout' : 'network')));
      });
      req.end(body);
    });
  }
}
