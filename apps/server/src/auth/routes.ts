import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiError, AuthSession, AuthStatus, User } from '@midas/shared';
import { UserRepo, toPublic, type StoredUser } from './users';
import { hashPassword, verifyPassword } from './password';
import { signToken, verifyToken } from './token';
import { createLoginThrottle, type LoginThrottle } from './throttle';

export interface AuthDeps {
  enabled: boolean;
  allowSignup: boolean;
  secret: string;
  users: UserRepo;
  /** Login brute-force brake; a default is created when omitted (tests inject). */
  throttle?: LoginThrottle;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_PASSWORD = 6;

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/**
 * Resolve the authenticated user from a request's bearer token: the signature
 * must be valid and unexpired, the user must exist, and the token's version
 * must match the user's current one (else it was revoked).
 */
export function userFromRequest(req: FastifyRequest, deps: AuthDeps): StoredUser | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const claims = verifyToken(header.slice(7), deps.secret, Date.now());
  if (!claims) return null;
  const user = deps.users.findById(claims.userId);
  if (!user || user.tokenVersion !== claims.version) return null;
  return user;
}

/** Whether new accounts may be created right now (always true to bootstrap the first). */
function canSignup(deps: AuthDeps): boolean {
  return deps.allowSignup || deps.users.count() === 0;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const session = (user: StoredUser): AuthSession => ({
    token: signToken(user.id, user.tokenVersion, Date.now() + TOKEN_TTL_MS, deps.secret),
    user: toPublic(user),
  });

  app.get('/api/auth/status', async (): Promise<AuthStatus> => ({
    enabled: deps.enabled,
    allowSignup: deps.enabled && canSignup(deps),
  }));

  app.get('/api/auth/me', async (req, reply): Promise<User | ApiError> => {
    const user = userFromRequest(req, deps);
    if (!user) {
      reply.code(401);
      return err(401, 'Unauthorized', 'Not signed in');
    }
    return toPublic(user);
  });

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/signup',
    async (req, reply): Promise<AuthSession | ApiError> => {
      if (!deps.enabled) {
        reply.code(400);
        return err(400, 'BadRequest', 'Auth is disabled');
      }
      if (!canSignup(deps)) {
        reply.code(403);
        return err(403, 'Forbidden', 'Signups are closed');
      }
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      if (username.length < 1 || password.length < MIN_PASSWORD) {
        reply.code(400);
        return err(400, 'BadRequest', `Username required and password ≥ ${MIN_PASSWORD} chars`);
      }
      if (deps.users.findByUsername(username)) {
        reply.code(409);
        return err(409, 'Conflict', 'Username is taken');
      }
      const user = deps.users.create(username, await hashPassword(password), Date.now());
      reply.code(201);
      return session(user);
    },
  );

  const throttle = deps.throttle ?? createLoginThrottle();

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply): Promise<AuthSession | ApiError> => {
      if (!deps.enabled) {
        reply.code(400);
        return err(400, 'BadRequest', 'Auth is disabled');
      }
      const username = (req.body?.username ?? '').trim();
      // Throttle per username+ip pair: repeated failures lock the pair out
      // briefly, making online password guessing impractically slow without
      // letting an attacker lock a victim out from a different address.
      const throttleKey = `${username.toLowerCase()}|${req.ip}`;
      const waitMs = throttle.check(throttleKey, Date.now());
      if (waitMs != null) {
        app.log.warn({ username, ip: req.ip }, 'login throttled');
        reply.code(429);
        return err(429, 'TooManyRequests', `Too many failed logins — try again in ${Math.ceil(waitMs / 1000)}s.`);
      }
      const user = deps.users.findByUsername(username);
      const ok = user ? await verifyPassword(req.body?.password ?? '', user.passwordHash) : false;
      if (!user || !ok) {
        throttle.fail(throttleKey, Date.now());
        reply.code(401);
        return err(401, 'Unauthorized', 'Invalid username or password');
      }
      throttle.succeed(throttleKey);
      return session(user);
    },
  );

  // Change password — requires the current one. Rotates the token version (so
  // other devices are signed out) and re-issues this caller a fresh session.
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/api/auth/password',
    async (req, reply): Promise<AuthSession | ApiError> => {
      if (!deps.enabled) {
        reply.code(400);
        return err(400, 'BadRequest', 'Auth is disabled');
      }
      const current = userFromRequest(req, deps);
      if (!current) {
        reply.code(401);
        return err(401, 'Unauthorized', 'Not signed in');
      }
      if (!(await verifyPassword(req.body?.currentPassword ?? '', current.passwordHash))) {
        reply.code(401);
        return err(401, 'Unauthorized', 'Current password is incorrect');
      }
      const next = req.body?.newPassword ?? '';
      if (next.length < MIN_PASSWORD) {
        reply.code(400);
        return err(400, 'BadRequest', `Password must be ≥ ${MIN_PASSWORD} chars`);
      }
      const updated = deps.users.setPassword(current.id, await hashPassword(next));
      if (!updated) {
        reply.code(404);
        return err(404, 'NotFound', 'No such user');
      }
      return session(updated);
    },
  );

  // Sign out other devices — rotate the token version, keep this caller signed
  // in with a fresh token.
  app.post('/api/auth/logout-all', async (req, reply): Promise<AuthSession | ApiError> => {
    if (!deps.enabled) {
      reply.code(400);
      return err(400, 'BadRequest', 'Auth is disabled');
    }
    const current = userFromRequest(req, deps);
    if (!current) {
      reply.code(401);
      return err(401, 'Unauthorized', 'Not signed in');
    }
    const updated = deps.users.rotateToken(current.id);
    if (!updated) {
      reply.code(404);
      return err(404, 'NotFound', 'No such user');
    }
    return session(updated);
  });

  // Admin: list all accounts.
  app.get('/api/auth/users', async (req, reply): Promise<User[] | ApiError> => {
    const current = userFromRequest(req, deps);
    if (!current) {
      reply.code(401);
      return err(401, 'Unauthorized', 'Not signed in');
    }
    if (!current.isAdmin) {
      reply.code(403);
      return err(403, 'Forbidden', 'Admin only');
    }
    return deps.users.list();
  });

  // Admin: remove an account (not your own).
  app.delete<{ Params: { id: string } }>(
    '/api/auth/users/:id',
    async (req, reply): Promise<{ ok: boolean } | ApiError> => {
      const current = userFromRequest(req, deps);
      if (!current) {
        reply.code(401);
        return err(401, 'Unauthorized', 'Not signed in');
      }
      if (!current.isAdmin) {
        reply.code(403);
        return err(403, 'Forbidden', 'Admin only');
      }
      if (req.params.id === current.id) {
        reply.code(400);
        return err(400, 'BadRequest', 'Cannot remove your own account');
      }
      if (!deps.users.remove(req.params.id)) {
        reply.code(404);
        return err(404, 'NotFound', 'No such user');
      }
      return { ok: true };
    },
  );
}
