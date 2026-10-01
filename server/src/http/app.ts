import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { loadConfig, type Config } from '../config.js';
import { Db } from '../db.js';
import { buildProviders, type Providers } from '../providers/index.js';
import { AppError } from './errors.js';
import type { Ctx } from './context.js';
import { RateLimiter, verifyToken } from './security.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerBasketRoutes } from './routes/baskets.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerMessagingRoutes } from './routes/messaging.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMerchantRoutes } from './routes/merchant.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerMiscRoutes } from './routes/misc.js';

export interface AppOptions { cfg?: Partial<Config>; providers?: Partial<Providers>; rateLimitScale?: number; logger?: boolean }

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const cfg = loadConfig(opts.cfg);
  const providers = { ...buildProviders(cfg), ...opts.providers } as Providers;
  const db = new Db(cfg);
  const ctx: Ctx = { cfg, db, providers, limiter: new RateLimiter(opts.rateLimitScale ?? 1) };
  const app = Fastify({ logger: opts.logger ? { level: 'info', redact: ['req.headers.authorization'] } : false, bodyLimit: 1_000_000 });

  await app.register(cors, { origin: [cfg.webOrigin, /^http:\/\/localhost:\d+$/, 'capacitor://localhost', 'https://localhost'], allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-signature'] });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  // keep the raw body for webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try { done(null, body ? JSON.parse(body as string) : {}); } catch { done(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.'), undefined); }
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const auth = req.headers.authorization;
    const tok = verifyToken(cfg.authSecret, auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!tok) return;
    const { rows } = await db.service.query('select id, role, status from users where id = $1', [tok.sub]);
    const u = rows[0];
    if (u && u.status !== 'deleted') {
      // restricted accounts may still read their own data but cannot transact (checked in routes via req.restricted)
      req.user = { id: u.id, role: u.role };
      (req as any).restricted = u.status === 'restricted';
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Some fields are invalid.', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) } });
    }
    if (err?.code === '42501') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do this.' } });
    if (err?.code === '23505') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'This already exists.' } });
    if (err?.code === '23514' || err?.code === '23503' || err?.code === '22P02') {
      return reply.status(409).send({ error: { code: 'CONSTRAINT', message: 'This change is not allowed in the current state.' } });
    }
    if (err?.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    req.log.error({ err: { message: err?.message, code: err?.code } }, 'unhandled');   // never log bodies, tokens or addresses
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Your data was not changed. Please try again.' } });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(async (api) => {
    api.get('/health', async () => ({ ok: true }));
    registerAuthRoutes(api, ctx);
    registerPublicRoutes(api, ctx);
    registerBasketRoutes(api, ctx);
    registerOrderRoutes(api, ctx);
    registerMessagingRoutes(api, ctx);
    registerMeRoutes(api, ctx);
    registerMerchantRoutes(api, ctx);
    registerAdminRoutes(api, ctx);
    registerMiscRoutes(api, ctx);
  }, { prefix: '/api' });

  app.addHook('onClose', async () => { await db.close(); });
  const sweeper = setInterval(() => ctx.limiter.sweep(), 60_000); sweeper.unref();
  return { app, ctx };
}
