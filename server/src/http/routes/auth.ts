import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { limit, requireUser, type Ctx } from '../context.js';
import { hashOtp, normalizeUaePhone, signToken } from '../security.js';

const Phone = z.string().min(8).max(20);

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/auth/otp/request', async (req, reply) => {
    const { phone: raw } = z.object({ phone: Phone }).parse(req.body);
    const phone = normalizeUaePhone(raw);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid UAE mobile number, for example 050 123 4567.');
    limit(ctx, req, reply, 'otp-ip', 20, 600);
    limit(ctx, req, reply, 'otp-phone', 5, 600, phone);
    const code = ctx.providers.otp.generateCode();
    await ctx.db.asService(async (q) => {
      await q.query('insert into otp_codes(phone, code_hash, expires_at) values ($1,$2, now() + interval \'5 minutes\')', [phone, hashOtp(ctx.cfg.authSecret, phone, code)]);
    });
    await ctx.providers.otp.send(phone, code);
    return { phone, expiresInSec: 300, mode: ctx.providers.otp.mode, testModeNote: ctx.providers.otp.mode === 'mock' ? 'Test mode: no SMS is sent. Use the local test code from the README.' : undefined };
  });

  app.post('/auth/otp/verify', async (req, reply) => {
    const b = z.object({
      phone: Phone, code: z.string().regex(/^\d{4,8}$/), name: z.string().trim().min(1).max(80).optional(),
      accountType: z.enum(['customer', 'merchant']).default('customer'), locale: z.enum(['ar', 'en']).optional(),
    }).parse(req.body);
    const phone = normalizeUaePhone(b.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid UAE mobile number.');
    limit(ctx, req, reply, 'otp-verify', 15, 600, phone);
    // NOTE: failures are returned (not thrown) from the transaction so the attempt counter is committed, not rolled back.
    const outcome = await ctx.db.asService(async (q) => {
      const { rows } = await q.query('select * from otp_codes where phone = $1 and consumed_at is null order by created_at desc limit 1 for update', [phone]);
      const otp = rows[0];
      if (!otp || new Date(otp.expires_at) < new Date()) return { error: new AppError(400, 'OTP_EXPIRED', 'This code has expired. Request a new code.') };
      if (otp.attempts >= 5) return { error: new AppError(429, 'OTP_LOCKED', 'Too many wrong attempts. Request a new code.') };
      if (otp.code_hash !== hashOtp(ctx.cfg.authSecret, phone, b.code)) {
        await q.query('update otp_codes set attempts = attempts + 1 where id = $1', [otp.id]);
        return { error: new AppError(400, 'OTP_INVALID', 'That code is not correct. Check the code and try again.', { attemptsLeft: 4 - otp.attempts }) };
      }
      await q.query('update otp_codes set consumed_at = now() where id = $1', [otp.id]);
      let u = (await q.query('select * from users where phone = $1', [phone])).rows[0];
      if (u?.status === 'deleted') return { error: new AppError(403, 'ACCOUNT_DELETED', 'This account was deleted.') };
      if (!u) {
        u = (await q.query('insert into users(phone,name,role,locale) values ($1,$2,$3,$4) returning *', [phone, b.name ?? null, b.accountType, b.locale ?? 'ar'])).rows[0];
        await q.query(`insert into consents(user_id,kind,granted) values ($1,'terms',true)`, [u.id]);
      }
      return { user: u };
    });
    if ('error' in outcome) throw outcome.error;
    const user = outcome.user;
    const token = signToken(ctx.cfg.authSecret, { sub: user.id }, 30 * 24 * 3600);
    return { token, user: { id: user.id, role: user.role, name: user.name, locale: user.locale, phone: user.phone, status: user.status } };
  });

  app.get('/auth/me', async (req) => {
    const u = requireUser(req);
    return ctx.db.asUser(u, async (q) => (await q.query('select id, phone, name, email, role, locale, status, marketing_opt_in, preferences from users where id = $1', [u.id])).rows[0]);
  });
}
