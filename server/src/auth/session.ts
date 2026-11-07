import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../crypto.js';
import type { User } from '../db/schema.js';

// Former project name kept on purpose: renaming would log everyone out.
export const SESSION_COOKIE = 'lumio_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000;

export function createSession(reply: FastifyReply, userId: number) {
  const id = randomToken(32);
  db.insert(schema.sessions).values({ id, userId, expiresAt: Date.now() + SESSION_TTL }).run();
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now())).run();
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    signed: true,
    maxAge: SESSION_TTL / 1000,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const id = readSessionId(req);
  if (id) db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readSessionId(req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const res = req.unsignCookie(raw);
  return res.valid ? res.value : null;
}

export function currentUser(req: FastifyRequest): User | null {
  const id = readSessionId(req);
  if (!id) return null;
  const row = db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, Date.now())))
    .get();
  return row?.user ?? null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(req);
  if (!user) return reply.code(401).send({ error: 'Not logged in' });
  req.user = user;
}
