#!/usr/bin/env node

/**
 * Build and serve Midas's static, synthetic reviewer demo.
 *
 * The static build contains an in-browser data engine and never needs the
 * Fastify server, a provider credential, a webhook, or a persistent data dir.
 * This launcher adds a small loopback-only server so a reviewer has one safe
 * command to run after cloning the repository.
 */

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEMO_PREFIX = '/Midas/demo';
export const DEFAULT_PORT = 4173;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SENSITIVE_ENV = /(^|_)(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|COOKIE|PRIVATE_KEY|DATABASE_URL)($|_)/i;

export function parseArgs(argv = []) {
  let port = DEFAULT_PORT;
  let build = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-build') {
      build = false;
      continue;
    }
    if (arg === '--port') {
      const value = argv[++i];
      port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer between 1 and 65535');
      }
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer between 1 and 65535');
      }
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, port, build };
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { help: false, port, build };
}

/** Return a build environment that cannot accidentally expose local secrets. */
export function reviewerEnvironment(base = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (
      name.startsWith('MIDAS_') ||
      name.startsWith('VITE_MIDAS_') ||
      name === 'ANTHROPIC_API_KEY' ||
      SENSITIVE_ENV.test(name)
    ) {
      continue;
    }
    env[name] = value;
  }
  env.NODE_ENV = 'production';
  env.VITE_MIDAS_STATIC_DEMO = 'true';
  return env;
}

/** Map a request below the GitHub Pages base path into the demo build root. */
export function resolveDemoPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split('?')[0]);
  } catch {
    return null;
  }

  const prefixes = [DEMO_PREFIX, '/demo'];
  const prefix = decoded === '/' ? '' : prefixes.find((candidate) => decoded === candidate || decoded.startsWith(`${candidate}/`));
  if (prefix === undefined) return null;

  const suffix = prefix === '' ? decoded : decoded.slice(prefix.length) || '/';
  const candidate = resolve(root, `.${suffix}`);
  const withinRoot = relative(root, candidate);
  if (withinRoot === '..' || withinRoot.startsWith('../') || withinRoot.startsWith('..\\')) return null;
  return candidate;
}

function contentType(file) {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
    }[extname(file).toLowerCase()] ?? 'application/octet-stream'
  );
}

export function createDemoServer(root) {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end('Method Not Allowed\n');
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const requested = resolveDemoPath(root, pathname);
    if (!requested) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found\n');
      return;
    }

    let file = requested;
    if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Demo build is missing. Run pnpm reviewer:demo without --no-build.\n');
      return;
    }

    const headers = {
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'content-type': contentType(file),
      'x-content-type-options': 'nosniff',
    };
    const body = readFileSync(file);
    response.writeHead(200, { ...headers, 'content-length': body.length });
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  });
}

function buildDemo() {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['--filter', '@midas/web', 'build:demo'], {
    cwd: ROOT,
    env: reviewerEnvironment(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`static demo build exited with status ${result.status}`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: pnpm reviewer:demo [--port 4173] [--no-build]');
    return 0;
  }
  if (options.build) buildDemo();

  const root = join(ROOT, 'apps', 'web', 'dist-demo');
  const server = createDemoServer(root);
  const close = (code) => {
    server.close(() => process.exit(code));
  };
  process.once('SIGINT', () => close(130));
  process.once('SIGTERM', () => close(143));
  server.listen(options.port, '127.0.0.1', () => {
    console.log('Midas reviewer demo');
    console.log(`  open: http://127.0.0.1:${options.port}${DEMO_PREFIX}/`);
    console.log('  data: deterministic synthetic browser demo');
    console.log('  network: loopback server only; no API, exchange, webhook, or model calls');
    console.log('  stop: Ctrl+C');
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
