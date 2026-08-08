// @vitest-environment jsdom
// Personal-webhook UI tests. Every API seam is mocked: no endpoint in this
// suite can perform a real outbound delivery or contact a Midas server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type {
  AccountWebhookEnabledInput,
  AccountWebhookInput,
  AccountWebhookResponse,
} from '@midas/shared';
import { WebhookSettings } from './WebhookSettings';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const accountWebhookMock = vi.hoisted(() =>
  vi.fn<(signal?: AbortSignal) => Promise<AccountWebhookResponse>>(),
);
const saveWebhookMock = vi.hoisted(() =>
  vi.fn<(input: AccountWebhookInput) => Promise<AccountWebhookResponse>>(),
);
const toggleWebhookMock = vi.hoisted(() =>
  vi.fn<(input: AccountWebhookEnabledInput) => Promise<AccountWebhookResponse>>(),
);
const deleteWebhookMock = vi.hoisted(() => vi.fn<() => Promise<{ ok: boolean }>>());

vi.mock('@/lib/api', () => ({
  api: {
    accountWebhook: accountWebhookMock,
    saveAccountWebhook: saveWebhookMock,
    setAccountWebhookEnabled: toggleWebhookMock,
    deleteAccountWebhook: deleteWebhookMock,
  },
}));

const EMPTY: AccountWebhookResponse = {
  webhook: null,
  fillNotificationsAvailable: true,
  digestHours: 24,
};

function configured(
  overrides: Partial<NonNullable<AccountWebhookResponse['webhook']>> = {},
): AccountWebhookResponse {
  return {
    ...EMPTY,
    webhook: {
      enabled: false,
      createdAt: 1_780_000_000_000,
      updatedAt: 1_780_000_000_000,
      lastDelivery: null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  accountWebhookMock.mockReset().mockResolvedValue(EMPTY);
  saveWebhookMock.mockReset();
  toggleWebhookMock.mockReset();
  deleteWebhookMock.mockReset();
});
afterEach(cleanup);

describe('WebhookSettings', () => {
  it('starts disabled and exposes a labelled, blank HTTPS URL input', async () => {
    render(createElement(WebhookSettings));

    const input = (await screen.findByLabelText('Webhook URL')) as HTMLInputElement;
    expect(input.type).toBe('url');
    expect(input.value).toBe('');
    expect(input.autocomplete).toBe('off');

    const toggle = screen.getByRole('switch', { name: 'Webhook delivery' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Daily P&L recaps are available/)).toBeTruthy();
  });

  it('saves write-only configuration, clears the URL, and does not auto-enable delivery', async () => {
    const saved = configured();
    saveWebhookMock.mockImplementation(async () => {
      accountWebhookMock.mockResolvedValue(saved);
      return saved;
    });
    const secretUrl = 'https://hooks.example.net/private-token-123';
    const { container } = render(createElement(WebhookSettings));

    const input = (await screen.findByLabelText('Webhook URL')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: secretUrl } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(saveWebhookMock).toHaveBeenCalledWith({ url: secretUrl }));
    expect(await screen.findByText(/Webhook saved and validated/)).toBeTruthy();
    expect(screen.queryByLabelText('Webhook URL')).toBeNull();
    expect(container.textContent).not.toContain(secretUrl);
    expect(screen.getByText('Saved address hidden')).toBeTruthy();

    const toggle = screen.getByRole('switch', { name: 'Webhook delivery' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('replaces through a blank input and preserves the explicit enable step', async () => {
    accountWebhookMock.mockResolvedValue(configured({ enabled: true }));
    const replaced = configured({ enabled: false, updatedAt: 1_780_000_001_000 });
    saveWebhookMock.mockImplementation(async () => {
      accountWebhookMock.mockResolvedValue(replaced);
      return replaced;
    });
    render(createElement(WebhookSettings));

    fireEvent.click(await screen.findByRole('button', { name: 'replace…' }));
    const input = screen.getByLabelText('Replacement webhook URL') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'https://new.example.net/midas' } });
    fireEvent.submit(input.closest('form')!);

    await screen.findByText(/Delivery remains disabled/);
    expect(
      screen.getByRole('switch', { name: 'Webhook delivery' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('enables and disables only through the accessible switch PATCH', async () => {
    accountWebhookMock.mockResolvedValue(configured());
    const enabled = configured({ enabled: true });
    toggleWebhookMock.mockImplementation(async () => {
      accountWebhookMock.mockResolvedValue(enabled);
      return enabled;
    });
    render(createElement(WebhookSettings));

    const toggle = (await screen.findByRole('switch', {
      name: 'Webhook delivery',
    })) as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(toggleWebhookMock).toHaveBeenCalledWith({ enabled: true }));
    expect(screen.getByRole('switch', { name: 'Webhook delivery' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(await screen.findByText('Personal webhook delivery enabled.')).toBeTruthy();
  });

  it('disables every control while a mutation is in flight', async () => {
    accountWebhookMock.mockResolvedValue(configured());
    let finish!: (value: AccountWebhookResponse) => void;
    toggleWebhookMock.mockReturnValue(
      new Promise<AccountWebhookResponse>((resolve) => {
        finish = resolve;
      }),
    );
    render(createElement(WebhookSettings));

    const toggle = (await screen.findByRole('switch', {
      name: 'Webhook delivery',
    })) as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(toggle.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'replace…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'clear webhook' }) as HTMLButtonElement).disabled).toBe(true);

    const enabled = configured({ enabled: true });
    accountWebhookMock.mockResolvedValue(enabled);
    finish(enabled);
    await screen.findByText('Personal webhook delivery enabled.');
  });

  it('clears the saved configuration with DELETE and returns to disabled-by-default', async () => {
    accountWebhookMock.mockResolvedValue(configured({ enabled: true }));
    deleteWebhookMock.mockImplementation(async () => {
      accountWebhookMock.mockResolvedValue(EMPTY);
      return { ok: true };
    });
    render(createElement(WebhookSettings));

    fireEvent.click(await screen.findByRole('button', { name: 'clear webhook' }));
    await waitFor(() => expect(deleteWebhookMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved webhook cleared. Delivery is off.')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Webhook delivery' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByLabelText('Webhook URL')).toBeTruthy();
  });

  it('shows operator guidance when the feature is unavailable', async () => {
    accountWebhookMock.mockRejectedValue(
      new Error('Personal webhooks are off on this server. Enable MIDAS_USER_WEBHOOKS.'),
    );
    render(createElement(WebhookSettings));

    expect(await screen.findByText(/Personal webhooks are optional and off on this server/)).toBeTruthy();
    expect(screen.getByText('MIDAS_USER_WEBHOOKS=true')).toBeTruthy();
    expect(screen.queryByLabelText('Webhook URL')).toBeNull();
  });

  it('sanitizes validation errors and delivery categories without exposing endpoint details', async () => {
    const attemptedUrl = 'https://user:private@example.net/midas';
    saveWebhookMock.mockRejectedValue(
      new Error(`Webhook rejected: ${attemptedUrl} token=private-value`),
    );
    render(createElement(WebhookSettings));
    const input = (await screen.findByLabelText('Webhook URL')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: attemptedUrl } });
    fireEvent.submit(input.closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain(attemptedUrl);
    expect(alert.textContent).not.toContain('private-value');

    cleanup();
    accountWebhookMock.mockResolvedValue(
      configured({
        lastDelivery: {
          kind: 'digest',
          outcome: 'failed',
          failureCategory: 'timeout',
          at: Date.now(),
        },
      }),
    );
    const { container } = render(createElement(WebhookSettings));
    expect(await screen.findByText(/P&L recap failed: delivery timed out/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/https?:\/\//);
    expect(screen.queryByRole('button', { name: /test webhook/i })).toBeNull();
  });
});
