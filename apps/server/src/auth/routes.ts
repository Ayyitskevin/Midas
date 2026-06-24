import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiError, AuthSession, AuthStatus, User } from '@midas/shared';
import { UserRepo, toPublic } from './users';
import { hashPassword, verifyPassword } from './password';
import { signToken, verifyToken } from './token';

export interface AuthDeps {
  enabled: boolean;
  allowSignup: boolean;
  secret: string;
  users: UserRepo;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_PASSWORD = 6;

function err(statusCode: number, error: string, message: string): ApiError {
  return { error, message, statusCode };
}

/** Pull a verified user id from a request's `Authorization: Bearer` header. */
export function userIdFromRequest(req: FastifyRequest, secret: string): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7), secret, Date.now());
}

/** Whether new accounts may be created right now (always true to bootstrap the first). */
function canSignup(deps: AuthDeps): boolean {
  return deps.allowSignup || deps.users.count() === 0;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const session = (user: { id: string; username: string; createdAt: number }): AuthSession => ({
    token: signToken(user.id, Date.now() + TOKEN_TTL_MS, deps.secret),
    user,
  });

  app.get('/api/auth/status', async (): Promise<AuthStatus> => ({
    enabled: deps.enabled,
    allowSignup: deps.enabled && canSignup(deps),
  }));

  app.get('/api/auth/me', async (req, reply): Promise<User | ApiError> => {
    const id = userIdFromRequest(req, deps.secret);
    const user = id ? deps.users.findById(id) : undefined;
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
      return session(toPublic(user));
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply): Promise<AuthSession | ApiError> => {
      if (!deps.enabled) {
        reply.code(400);
        return err(400, 'BadRequest', 'Auth is disabled');
      }
      const username = (req.body?.username ?? '').trim();
      const user = deps.users.findByUsername(username);
      const ok = user ? await verifyPassword(req.body?.password ?? '', user.passwordHash) : false;
      if (!user || !ok) {
        reply.code(401);
        return err(401, 'Unauthorized', 'Invalid username or password');
      }
      return session(toPublic(user));
    },
  );
}
