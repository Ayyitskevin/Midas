/**
 * Log-boundary helpers. Logs may describe an event and a bounded error class,
 * but never copy request credentials, account identifiers, values, or raw
 * upstream error text (which can contain signed URLs and machine-local paths).
 */

export const SAFE_LOG_REDACT_PATHS = [
  'authorization',
  'cookie',
  'apiKey',
  'secret',
  'password',
  'token',
  'signature',
  'keyLast4',
  'userId',
  'username',
  'ip',
  'err',
  'error',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.secret',
  '*.password',
  '*.token',
  '*.signature',
  '*.keyLast4',
  '*.userId',
  '*.username',
  '*.ip',
  '*.err',
  '*.error',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
] as const;

export interface SafeErrorFields {
  errorType: string;
}

const ERROR_TYPE_TAXONOMY = new Set([
  'AbortError',
  'AggregateError',
  'Error',
  'FastifyError',
  'ProviderError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
]);

/** Reduce an arbitrary thrown value to allowlisted taxonomy only. */
export function safeErrorFields(error: unknown): SafeErrorFields {
  if (error == null || (typeof error !== 'object' && typeof error !== 'function')) {
    return { errorType: 'UnknownError' };
  }
  const candidate = error as { name?: unknown };
  // Error.name and `.code` are mutable and may contain upstream-controlled
  // strings. Only exact, fixed taxonomy members cross the log boundary.
  const errorType =
    typeof candidate.name === 'string' && ERROR_TYPE_TAXONOMY.has(candidate.name)
      ? candidate.name
      : 'Error';
  return { errorType };
}
