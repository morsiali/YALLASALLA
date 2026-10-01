import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, notFound, unprocessable } from '../errors.js';
import { asReqUser, limit, requireActive, type Ctx } from '../context.js';
import { ConstraintsSchema } from './public.js';
import { getOrderDetail, placeOrder, transitionOrder, decideSubstitution } from '../../services/orders.js';
import { loadProducts, loadProductsByIds, loadStore } from '../../services/loaders.js';
import { viewLine } from '../../services/basketView.js';
import { defaultConstraints, type Constraints } from '../../domain/types.js';
import { priceLines, budgetStatus } from '../../domain/pricing.js';
import { isEligible } from '../../domain/basketEngine.js';
import { getBalance, getRules } from '../../services/loyalty.js';

export function registerOrderRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/orders', async (req, reply) => {
    const user = requireActive(req);
    limit(ctx, req, reply, 'order', 15, 60);
    const idem = String(req.headers['idempotency-key'] ?? '');
    if (idem.length < 8 || idem.length > 100)
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A unique Idempotency-Key header (8-100 characters) is required to place an order safely.',
      );
    if (user.role !== 'customer')
      throw new AppError(403, 'CUSTOMERS_ONLY', 'Only customer accounts can place orders.');
    const b = z
      .object({
        storeId: z.string().uuid(),
        items: z
          .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
          .min(1)
          .max(200),
        constraints: ConstraintsSchema.default({}),
        address: z.object({
          addressId: z.string().uuid().optional(),
          areaId: z.string().uuid().optional(),
          building: z.string().trim().min(1).max(120).optional(),
          unit: z.string().max(40).optional(),
          instructions: z.string().max(300).optional(),
        }),
        contactName: z.string().max(80).optional(),
        notes: z.string().max(500).optional(),
        paymentMethod: z.enum(['cod', 'sandbox_card']),
        paymentToken: z.string().max(100).optional(),
        loyaltyPoints: z.number().int().min(0).max(1_000_000).optional(),
        approveOverBudget: z.boolean().optional(),
        generationId: z.string().uuid().nullable().optional(),
        reorderOf: z.string().uuid().nullable().optional(),
        acceptTerms: z.literal(true, {
          errorMap: () => ({ message: 'Please accept the terms and privacy policy to place the order.' }),
        }),
      })
      .parse(req.body);
    const res = await placeOrder(ctx, user, b as any, idem);
    const detail = await ctx.db.asUser(user, (q) => getOrderDetail(q, res.orderId));
    return reply.status(res.replay ? 200 : 201).send({ ...detail, idempotentReplay: res.replay });
  });

  app.get('/orders', async (req) => {
    const f = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        before: z.string().datetime().optional(),
        scope: z.enum(['mine']).default('mine'),
      })
      .parse(req.query);
    return asReqUser(
      ctx,
      req,
      async (q, u) =>
        (
          await q.query(
            `select o.id, o.order_no, o.status, o.total_minor, o.currency, o.placed_at, o.payment_method, o.payment_status, s.name_en as store_name_en, s.name_ar as store_name_ar,
              (select count(*)::int from order_items i where i.order_id = o.id and i.status in ('ok')) as item_count,
              exists (select 1 from substitution_requests sr where sr.order_id = o.id and sr.status = 'pending') as needs_decision
       from orders o join stores s on s.id = o.store_id
       where o.customer_id = $1 and ($2::timestamptz is null or o.placed_at < $2) order by o.placed_at desc limit $3`,
            [u.id, f.before ?? null, f.limit],
          )
        ).rows,
    );
  });

  app.get('/orders/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = await asReqUser(ctx, req, (q) => getOrderDetail(q, id));
    if (!d) throw notFound('Order'); // RLS hides other customers' / tenants' orders
    return d;
  });

  app.post('/orders/:id/cancel', async (req) => {
    const user = requireActive(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    return transitionOrder(ctx, user, id, 'cancelled', reason);
  });

  app.post('/orders/:id/substitutions/:sid', async (req) => {
    const user = requireActive(req);
    const { id, sid } = z.object({ id: z.string().uuid(), sid: z.string().uuid() }).parse(req.params);
    const { decision } = z.object({ decision: z.enum(['accept', 'reject']) }).parse(req.body);
    return decideSubstitution(ctx, user, id, sid, decision);
  });

  /** Before re-ordering: what changed since last time (price, availability, replacements) and the new total. */
  app.get('/orders/:id/reorder-preview', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      const o = (await q.query('select * from orders where id = $1', [id])).rows[0];
      if (!o) throw notFound('Order');
      const items = (
        await q.query(`select * from order_items where order_id = $1 and status in ('ok')`, [id])
      ).rows;
      const store = await loadStore(q, o.store_id);
      const current = await loadProductsByIds(
        q,
        items.map((i) => i.product_id),
      );
      const byId = new Map(current.map((p) => [p.id, p]));
      const c: Constraints = {
        ...defaultConstraints(),
        ...(o.constraints as object),
        substitutionPolicy: o.substitution_policy,
        budgetMinor: o.budget_minor,
        budgetIncludesDelivery: o.budget_includes_delivery ?? true,
      };
      const siblings = await loadProducts(q, [o.store_id]);
      const lines = items.map((it) => {
        const p = byId.get(it.product_id);
        const ok = p && p.stockQty >= it.qty;
        let suggestion = null as ReturnType<typeof viewLine> | null;
        if (!ok && p) {
          const alt = siblings
            .filter(
              (s) =>
                s.categoryCode === p.categoryCode &&
                s.id !== p.id &&
                s.stockQty >= it.qty &&
                isEligible(s, c),
            )
            .sort((a, b) => Math.abs(a.priceMinor - p.priceMinor) - Math.abs(b.priceMinor - p.priceMinor))[0];
          if (alt) suggestion = viewLine(alt, it.qty);
        }
        return {
          productId: it.product_id,
          qty: it.qty,
          name: { en: it.name_en, ar: it.name_ar },
          oldUnitPriceMinor: it.unit_price_minor,
          newUnitPriceMinor: p?.priceMinor ?? null,
          status:
            !p || p.stockQty <= 0
              ? 'unavailable'
              : p.stockQty < it.qty
                ? 'limited'
                : p.priceMinor !== it.unit_price_minor
                  ? 'price_changed'
                  : 'same',
          suggestion,
        };
      });
      const available = lines.filter((l) => l.status !== 'unavailable' && l.status !== 'limited');
      const priced = priceLines(
        available.map((l) => ({ product: byId.get(l.productId)!, qty: l.qty })),
        store!,
        0,
      );
      return {
        storeId: o.store_id,
        previousOrderNo: o.order_no,
        previousTotalMinor: o.total_minor,
        previousSubtotalMinor: o.subtotal_minor,
        previousDeliveryFeeMinor: o.delivery_fee_minor,
        lines,
        totals: priced.totals,
        differenceMinor: priced.totals.totalMinor - o.total_minor,
        budget: budgetStatus(priced.totals, c.budgetMinor, c.budgetIncludesDelivery),
        constraints: c,
      };
    });
  });

  app.post('/orders/:id/dispute', async (req, reply) => {
    const user = requireActive(req);
    limit(ctx, req, reply, 'dispute', 10, 3600);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(2000) }).parse(req.body);
    return ctx.db.asUser(user, async (q) => {
      const o = (
        await q.query('select id, status from orders where id = $1 and customer_id = $2', [id, user.id])
      ).rows[0];
      if (!o) throw notFound('Order');
      if (o.status === 'pending_payment')
        throw unprocessable('NOT_DISPUTABLE', 'This order is still waiting for payment confirmation.');
      const open = await q.query(
        `select 1 from disputes where order_id = $1 and status in ('open','under_review')`,
        [id],
      );
      if (open.rowCount)
        throw new AppError(409, 'DISPUTE_EXISTS', 'You already have an open dispute for this order.');
      const d = (
        await q.query(
          'insert into disputes(order_id,opened_by,reason) values ($1,$2,$3) returning id, status',
          [id, user.id, reason],
        )
      ).rows[0];
      await q.query(
        `insert into dispute_events(dispute_id,actor_id,action,note) values ($1,$2,'opened',$3)`,
        [d.id, user.id, reason],
      );
      return d;
    });
  });

  app.get('/loyalty', async (req) =>
    asReqUser(ctx, req, async (q, u) => {
      const rules = await getRules(q);
      const bal = await getBalance(q, u.id);
      const ledger = await q.query(
        `select l.id, l.kind, l.points, l.available_at, l.reason, l.created_at, o.order_no,
              case when l.kind = 'earn' and exists (select 1 from loyalty_ledger r where r.reverses_id = l.id) then 'reversed'
                   when l.kind = 'earn' and l.available_at > now() then 'pending' else 'posted' end as status
       from loyalty_ledger l left join orders o on o.id = l.order_id where l.user_id = $1 order by l.id desc limit 100`,
        [u.id],
      );
      return {
        ...bal,
        valueAedForAvailable: (bal.available * rules.pointValueMinor) / 100,
        rules,
        ledger: ledger.rows,
      };
    }),
  );
}
