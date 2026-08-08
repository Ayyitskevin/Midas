import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Tight enough for ordinary incoming-webhook URLs while bounding stored input. */
export const MAX_USER_WEBHOOK_URL_LENGTH = 2_048;
const DNS_TIMEOUT_MS = 2_000;
const MAX_DNS_ANSWERS = 16;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ResolvedWebhookTarget {
  /** Canonical HTTPS URL. Kept server-side only; never returned or logged. */
  url: URL;
  /** Original public hostname used for Host/TLS SNI. */
  hostname: string;
  /** One already-validated public address; the transport connects to it directly. */
  address: string;
  family: 4 | 6;
}

export type WebhookUrlErrorCategory = 'invalid' | 'blocked-target' | 'dns';

export class WebhookUrlError extends Error {
  override readonly name = 'WebhookUrlError';

  constructor(
    readonly category: WebhookUrlErrorCategory,
    message: string,
  ) {
    super(message);
  }
}

// Keep address families in separate lists. Node's BlockList intentionally
// treats IPv4 addresses as IPv4-mapped IPv6 when both families share a list;
// that would make an `::ffff:0:0/96` rule accidentally reject every public
// IPv4 address too.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // IPv4-compatible forms such as ::127.0.0.1 are not global IPv6 targets.
  ['::', 96],
  // Reject IPv4-mapped/NAT64 forms instead of trying to recover a second
  // address family from them. Normal public DNS answers return native v4/v6.
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

const BLOCKED_EXACT_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.aws.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home',
  '.lan',
  '.test',
  '.invalid',
  '.example',
  '.onion',
];

function publicAddress(address: string, family: 4 | 6): boolean {
  if (isIP(address) !== family) return false;
  return family === 4
    ? !blockedV4.check(address, 'ipv4')
    : globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

const defaultResolver: WebhookResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers
    .filter((answer): answer is { address: string; family: 4 | 6 } => answer.family === 4 || answer.family === 6)
    .map(({ address, family }) => ({ address, family }));
};

async function resolveBounded(resolver: WebhookResolver, hostname: string): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new WebhookUrlError('dns', 'Webhook hostname resolution timed out.')),
          DNS_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validate a user-controlled endpoint and resolve every DNS answer before it
 * can be persisted or contacted. The returned address is later pinned by the
 * HTTPS transport, closing the usual validate-then-resolve DNS-rebinding gap.
 */
export async function resolveWebhookTarget(
  raw: string,
  resolver: WebhookResolver = defaultResolver,
): Promise<ResolvedWebhookTarget> {
  const value = raw.trim();
  if (!value || value.length > MAX_USER_WEBHOOK_URL_LENGTH) {
    throw new WebhookUrlError('invalid', `Webhook URL must be 1-${MAX_USER_WEBHOOK_URL_LENGTH} characters.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookUrlError('invalid', 'Webhook URL is malformed.');
  }
  if (url.protocol !== 'https:') {
    throw new WebhookUrlError('invalid', 'Webhook URL must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('invalid', 'Webhook URL must not contain credentials.');
  }
  if (url.hash) {
    throw new WebhookUrlError('invalid', 'Webhook URL must not contain a fragment.');
  }
  if (url.port && url.port !== '443') {
    throw new WebhookUrlError('invalid', 'Webhook URL must use the standard HTTPS port.');
  }

  const bracketless = url.hostname.replace(/^\[|\]$/g, '');
  const hostname = bracketless.replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new WebhookUrlError('invalid', 'Webhook URL must include a hostname.');

  const literalFamily = isIP(hostname);
  if (!literalFamily) {
    // Single-label and special-use names are local/infrastructure targets even
    // before DNS is consulted. Known cloud metadata aliases receive the same
    // fail-closed treatment.
    if (
      !hostname.includes('.') ||
      BLOCKED_EXACT_HOSTS.has(hostname) ||
      BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
      throw new WebhookUrlError('blocked-target', 'Webhook target is not a public Internet host.');
    }
    if (hostname !== bracketless.toLowerCase()) url.hostname = hostname;
  }

  // URL parsing percent-encodes Unicode, so a short UTF-16 input can expand
  // several-fold. Bound the actual canonical UTF-8 value that would be
  // encrypted, persisted, and placed on the request line.
  const canonical = url.toString();
  if (
    canonical.length > MAX_USER_WEBHOOK_URL_LENGTH ||
    Buffer.byteLength(canonical) > MAX_USER_WEBHOOK_URL_LENGTH
  ) {
    throw new WebhookUrlError(
      'invalid',
      `Canonical webhook URL must be at most ${MAX_USER_WEBHOOK_URL_LENGTH} bytes.`,
    );
  }

  let answers: ResolvedAddress[];
  if (literalFamily === 4 || literalFamily === 6) {
    answers = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      answers = await resolveBounded(resolver, hostname);
    } catch (error) {
      if (error instanceof WebhookUrlError) throw error;
      throw new WebhookUrlError('dns', 'Webhook hostname could not be resolved.');
    }
  }

  if (answers.length === 0 || answers.length > MAX_DNS_ANSWERS) {
    throw new WebhookUrlError('dns', 'Webhook hostname did not resolve to a bounded public address set.');
  }
  // Reject the entire hostname when ANY answer is special-use. Choosing only a
  // public answer from a mixed set would let an attacker steer a later retry to
  // the private member of that set.
  if (answers.some(({ address, family }) => !publicAddress(address, family))) {
    throw new WebhookUrlError('blocked-target', 'Webhook target resolves to a private or reserved network.');
  }

  const [chosen] = answers;
  return { url, hostname, address: chosen.address, family: chosen.family };
}
