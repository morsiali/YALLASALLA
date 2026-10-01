import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db, Q, SessionUser } from '../db.js';
import type { Providers } from '../providers/index.js';
import type { RateLimiter } from './security.js';
import { AppError, forbidden } from './errors.js';

export interface Ctx { cfg: Config; db: Db; providers: Providers; limiter: RateLimiter }

declare module 'fastify' {
  interface FastifyRequest { user: SessionUser | null; rawBody?: string }
}

export const requireUser = (req: FastifyRequest): SessionUser => {
  if (!req.user) throw new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  return req.user;
};
export const requireRole = (req: FastifyRequest, ...roles: SessionUser['role'][]): SessionUser => {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden('Your account type cannot do this.');
  return u;
};
/** Run work as the authenticated user under RLS. */
export const asReqUser = <T>(ctx: Ctx, req: FastifyRequest, fn: (q: Q, u: SessionUser) => Promise<T>) => {
  const u = requireUser(req);
  return ctx.db.asUser(u, (q) => fn(q, u));
};
export const limit = (ctx: Ctx, req: FastifyRequest, reply: FastifyReply, bucket: string, max: number, windowSec: number, by?: string) => {
  const wait = ctx.limiter.check(`${bucket}:${by ?? req.user?.id ?? req.ip}`, max, windowSec);
  if (wait > 0) {
    reply.header('retry-after', String(wait));
    throw new AppError(429, 'RATE_LIMITED', `Too many requests. Please try again in ${wait} seconds.`, { retryAfterSec: wait });
  }
};

/** Restricted accounts can read their data but cannot place orders, message or report. */
export const requireActive = (req: FastifyRequest): SessionUser => {
  const u = requireUser(req);
  if ((req as any).restricted) {
    throw new AppError(403, 'ACCOUNT_RESTRICTED', 'Your account is restricted, so you can view your data but not place orders or send messages. Contact support to review this.');
  }
  return u;
};
