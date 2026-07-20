/**
 * @midas/shared — the data contract shared between the Midas server and web client.
 *
 * Keep this package free of runtime dependencies: it is consumed as raw TypeScript
 * source by both the Fastify server (via tsx) and the Vite web client (via alias),
 * so anything imported here must be safe in both Node and browser environments.
 *
 * The contract is split into domain modules and re-exported here so the raw
 * consumption surface (`import { X } from '@midas/shared'`) stays unchanged.
 */

export * from './chart';
export * from './market';
export * from './solana';
export * from './account';
export * from './system';
export * from './provenance';

// Alert data contract + pure evaluator, shared by client and server.
export * from './alerts';

// Auth data contract, shared by client and server.
export * from './auth';
