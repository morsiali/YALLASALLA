import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { Ctx } from '../context.js';
import { applyPaymentEvent } from '../../services/orders.js';
import { verifyWebhook } from '../../providers/index.js';
import crypto from 'node:crypto';

export function registerMiscRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Provider webhook: HMAC signature verified over the raw body; idempotent on the provider's event id. */
  app.post('/webhooks/payments', async (req) => {
    const raw = req.rawBody ?? '';
    if (!verifyWebhook(ctx.cfg.webhookSecret, raw, req.headers['x-signature'] as string | undefined)) {
      throw new AppError(401, 'BAD_SIGNATURE', 'Webhook signature is invalid.');
    }
    const b = z
      .object({
        eventId: z.string().min(4).max(100),
        ref: z.string().min(4).max(100),
        status: z.enum(['succeeded', 'failed']),
      })
      .parse(req.body);
    const res = await applyPaymentEvent(ctx, {
      ...b,
      payloadHash: crypto.createHash('sha256').update(raw).digest('hex'),
    });
    return { received: true, applied: res.applied }; // 200 for duplicates so the provider stops retrying
  });
}
