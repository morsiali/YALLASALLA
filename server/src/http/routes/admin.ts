import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { asReqUser, requireRole, type Ctx } from '../context.js';
import { audit, notify } from '../../services/common.js';
import { resolveDispute, transitionOrder, getOrderDetail } from '../../services/orders.js';
import { runMaintenance } from '../../services/jobs.js';
import { getBalance } from '../../services/loyalty.js';

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = (req: any) => requireRole(req, 'admin');
  const ops = (req: any) => requireRole(req, 'admin', 'support');
  const reason = z.string().trim().min(5, 'A reason of at least 5 characters is required for this action.').max(500);

  app.get('/admin/kpis', async (req) => {
    const u = admin(req);
    return ctx.db.asService(async (q) => {
      const n = async (sql: string) => Number((await q.query(sql)).rows[0].v ?? 0);
      const gens = await n(`select count(*) v from basket_generations where created_at > now() - interval '30 days'`);
      const genOrders = await n(`select count(distinct generation_id) v from orders where generation_id is not null and placed_at > now() - interval '30 days'`);
      const ordersN = await n(`select count(*) v from orders where status <> 'pending_payment' and placed_at > now() - interval '30 days'`);
      const cancelled = await n(`select count(*) v from orders where status in ('cancelled','rejected') and placed_at > now() - interval '30 days'`);
      const subs = (await q.query(`select count(*)::int total, count(*) filter (where status in ('accepted','auto_applied'))::int ok from substitution_requests where created_at > now() - interval '30 days'`)).rows[0];
      const convUsers = await n(`select count(distinct c.customer_id) v from conversations c join orders o on o.customer_id = c.customer_id and o.store_id = c.store_id and o.placed_at > c.created_at where o.placed_at > now() - interval '30 days'`);
      const convAll = await n(`select count(*) v from conversations where created_at > now() - interval '30 days'`);
      return {
        window: '30d',
        basketsGenerated: gens, basketToOrderPct: gens ? Math.round((100 * genOrders) / gens) : null,
        avgTimeToBasketMs: Math.round(await n(`select avg((props->>'ms')::numeric) v from analytics_events where name = 'basket_generated' and created_at > now() - interval '30 days'`)),
        basketModifiedPct: gens ? Math.round((100 * await n(`select count(*) v from basket_generations where corrected_by_user and created_at > now() - interval '30 days'`)) / gens) : null,
        fallbackPct: gens ? Math.round((100 * await n(`select count(*) v from basket_generations where fallback_used and created_at > now() - interval '30 days'`)) / gens) : null,
        orders: ordersN, avgOrderMinor: Math.round(await n(`select avg(total_minor) v from orders where status = 'delivered' and placed_at > now() - interval '30 days'`)),
        cancellationPct: ordersN ? Math.round((100 * cancelled) / ordersN) : null,
        repeatOrders: await n(`select count(*) v from orders where reorder_of is not null and placed_at > now() - interval '30 days'`),
        substitutionRequests: subs.total, substitutionAcceptancePct: subs.total ? Math.round((100 * subs.ok) / subs.total) : null,
        conversationToOrderPct: convAll ? Math.round((100 * convUsers) / convAll) : null,
        avgMerchantAcceptMinutes: Number((await n(`select avg(extract(epoch from (h.created_at - o.placed_at)) / 60) v from orders o join order_status_history h on h.order_id = o.id and h.to_status = 'reviewing' where o.placed_at > now() - interval '30 days'`)).toFixed(1)),
        loyalty: (await q.query(`select coalesce(sum(points) filter (where kind = 'earn'),0)::int earned, coalesce(-sum(points) filter (where kind = 'redeem'),0)::int redeemed, coalesce(-sum(points) filter (where kind in ('earn_reversal','redeem_reversal')),0)::int reversed, coalesce(-sum(points) filter (where kind = 'expire'),0)::int expired from loyalty_ledger where created_at > now() - interval '30 days'`)).rows[0],
        disputes: await n(`select count(*) v from disputes where created_at > now() - interval '30 days'`),
        openReports: await n(`select count(*) v from reports where status = 'open'`),
        pendingMerchants: await n(`select count(*) v from businesses where status = 'pending'`),
        note: 'Delivery cost, contribution margin and on-time delivery need courier/accounting data that the MVP does not collect.', requestedBy: u.id,
      };
    });
  });

  // ── merchants
  app.get('/admin/businesses', async (req) => {
    ops(req);
    const f = z.object({ status: z.string().optional() }).parse(req.query);
    return asReqUser(ctx, req, async (q) => (await q.query(
      `select b.id, b.name_en, b.name_ar, b.status, b.trade_license_no, b.contact_phone, b.review_note, b.created_at, p.code as package_code,
              (select count(*)::int from products pr join stores s on s.id = pr.store_id where s.business_id = b.id) as product_count
       from businesses b left join packages p on p.id = b.package_id where ($1::text is null or b.status = $1) order by b.created_at desc`, [f.status ?? null])).rows);
  });
  app.post('/admin/businesses/:id/review', async (req) => {
    const u = admin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']), note: z.string().max(500).optional() }).parse(req.body);
    if ((b.decision === 'reject' || b.decision === 'suspend') && (!b.note || b.note.trim().length < 5)) throw unprocessable('REASON_REQUIRED', 'Explain the reason so the merchant can respond.');
    const status = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'approved' }[b.decision];
    return ctx.db.asService(async (q) => {
      const cur = (await q.query('select * from businesses where id = $1 for update', [id])).rows[0];
      if (!cur) throw notFound('Business');
      if (b.decision === 'approve' && cur.status !== 'pending') throw conflict('INVALID_STATE', 'Only businesses waiting for review can be approved.');
      if (b.decision === 'reinstate' && cur.status !== 'suspended') throw conflict('INVALID_STATE', 'Only suspended businesses can be reinstated.');
      await q.query('update businesses set status = $2, review_note = $3, reviewed_at = now() where id = $1', [id, status, b.note ?? null]);
      await audit(q, u.id, `business.${b.decision}`, 'business', id, b.note ?? null, { from: cur.status, to: status });
      await notify(ctx, q, cur.owner_id, 'business_review', { businessId: id, status, note: b.note ?? null });
      return { id, status };
    }, u.id);
  });

  // ── packages, areas, categories (admin-only RLS policies enforce this at the database as well)
  const PackageBody = z.object({
    code: z.string().trim().min(2).max(40), nameEn: z.string().trim().min(2).max(60), nameAr: z.string().trim().min(2).max(60),
    priceMinor: z.number().int().min(0), billingInterval: z.enum(['month', 'year']), trialDays: z.number().int().min(0).max(90), active: z.boolean().default(true),
    entitlements: z.object({ max_products: z.number().int().min(0), max_ready_baskets: z.number().int().min(0), staff_seats: z.number().int().min(0), messages_per_day: z.number().int().min(0), analytics: z.enum(['basic', 'advanced']), max_stores: z.number().int().min(1) }),
  });
  app.get('/admin/packages', async (req) => { admin(req); return asReqUser(ctx, req, async (q) => (await q.query('select * from packages order by price_minor')).rows); });
  app.post('/admin/packages', async (req, reply) => {
    const u = admin(req); const b = PackageBody.parse(req.body);
    const row = await asReqUser(ctx, req, async (q) => {
      const r = (await q.query('insert into packages(code,name_en,name_ar,price_minor,billing_interval,trial_days,entitlements,active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *', [b.code, b.nameEn, b.nameAr, b.priceMinor, b.billingInterval, b.trialDays, JSON.stringify(b.entitlements), b.active])).rows[0];
      await audit(q, u.id, 'package.create', 'package', r.id, null, { code: b.code }); return r;
    });
    return reply.status(201).send(row);
  });
  app.put('/admin/packages/:id', async (req) => {
    const u = admin(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = PackageBody.parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query('update packages set code=$2,name_en=$3,name_ar=$4,price_minor=$5,billing_interval=$6,trial_days=$7,entitlements=$8,active=$9 where id=$1 returning *', [id, b.code, b.nameEn, b.nameAr, b.priceMinor, b.billingInterval, b.trialDays, JSON.stringify(b.entitlements), b.active]);
      if (!r.rows[0]) throw notFound('Package');
      await audit(q, u.id, 'package.update', 'package', id, null, { entitlements: b.entitlements, priceMinor: b.priceMinor }); return r.rows[0];
    });
  });
  app.post('/admin/areas', async (req, reply) => {
    const u = admin(req); const b = z.object({ emirate: z.string().min(2).max(40), nameEn: z.string().min(2).max(80), nameAr: z.string().min(2).max(80), lat: z.number().nullable().optional(), lng: z.number().nullable().optional() }).parse(req.body);
    const row = await asReqUser(ctx, req, async (q) => { const r = (await q.query('insert into areas(emirate,name_en,name_ar,lat,lng) values ($1,$2,$3,$4,$5) returning *', [b.emirate, b.nameEn, b.nameAr, b.lat ?? null, b.lng ?? null])).rows[0]; await audit(q, u.id, 'area.create', 'area', r.id, null, b); return r; });
    return reply.status(201).send(row);
  });
  app.put('/admin/stores/:id/areas', async (req) => {
    const u = admin(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = z.object({ areaIds: z.array(z.string().uuid()).min(1).max(40), reason }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      await q.query('delete from store_areas where store_id = $1', [id]);
      for (const a of b.areaIds) await q.query('insert into store_areas(store_id,area_id) values ($1,$2)', [id, a]);
      await audit(q, u.id, 'store.service_areas', 'store', id, b.reason, { areaIds: b.areaIds }); return { ok: true };
    });
  });
  app.post('/admin/categories', async (req, reply) => {
    const u = admin(req); const b = z.object({ code: z.string().regex(/^[a-z_]{2,40}$/), needGroup: z.enum(['essentials', 'breakfast_dairy', 'protein', 'fruits_veg', 'beverages', 'cleaning', 'personal_care', 'baby_family', 'optional']), nameEn: z.string().min(2).max(60), nameAr: z.string().min(2).max(60), sortOrder: z.number().int().default(99) }).parse(req.body);
    const row = await asReqUser(ctx, req, async (q) => { const r = (await q.query('insert into categories(code,need_group,name_en,name_ar,sort_order) values ($1,$2,$3,$4,$5) returning *', [b.code, b.needGroup, b.nameEn, b.nameAr, b.sortOrder])).rows[0]; await audit(q, u.id, 'category.create', 'category', r.id, null, b); return r; });
    return reply.status(201).send(row);
  });

  // ── basket rules + loyalty rules
  app.get('/admin/basket-rules', async (req) => { admin(req); return asReqUser(ctx, req, async (q) => (await q.query(
    `select r.*, c.code, c.name_en, c.name_ar, c.need_group from basket_rules r join categories c on c.id = r.category_id order by c.sort_order`)).rows); });
  app.put('/admin/basket-rules/:id', async (req) => {
    const u = admin(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ unitsPerPersonWeek: z.number().positive().max(100), priority: z.enum(['essential', 'standard', 'optional']), minUnits: z.number().int().min(0), maxUnits: z.number().int().min(1).max(200), highProteinBoost: z.number().min(1).max(3), active: z.boolean(), reason }).refine((x) => x.maxUnits >= x.minUnits, { message: 'Maximum must be at least the minimum.' }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query('update basket_rules set units_per_person_week=$2, priority=$3, min_units=$4, max_units=$5, high_protein_boost=$6, active=$7 where id=$1 returning *', [id, b.unitsPerPersonWeek, b.priority, b.minUnits, b.maxUnits, b.highProteinBoost, b.active]);
      if (!r.rows[0]) throw notFound('Basket rule');
      await audit(q, u.id, 'basket_rule.update', 'basket_rule', id, b.reason, { unitsPerPersonWeek: b.unitsPerPersonWeek, priority: b.priority }); return r.rows[0];
    });
  });
  app.put('/admin/loyalty-rules', async (req) => {
    const u = admin(req);
    const b = z.object({ earnPointsPerAed: z.number().min(0).max(20), holdDays: z.number().int().min(0).max(60), pointValueMinor: z.number().int().min(1).max(100), minRedeemPoints: z.number().int().min(0), maxRedeemPctOfSubtotal: z.number().int().min(0).max(100), expiryDays: z.number().int().min(30).max(1825), dailyEarnCapPoints: z.number().int().min(0), reason }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      await q.query('update loyalty_rules set earn_points_per_aed=$1,hold_days=$2,point_value_minor=$3,min_redeem_points=$4,max_redeem_pct_of_subtotal=$5,expiry_days=$6,daily_earn_cap_points=$7,updated_at=now() where id=1',
        [b.earnPointsPerAed, b.holdDays, b.pointValueMinor, b.minRedeemPoints, b.maxRedeemPctOfSubtotal, b.expiryDays, b.dailyEarnCapPoints]);
      await audit(q, u.id, 'loyalty_rules.update', 'loyalty_rules', '1', b.reason, { ...b, reason: undefined }); return { ok: true };
    });
  });
  app.post('/admin/loyalty/adjust', async (req) => {
    const u = admin(req);
    const b = z.object({ userId: z.string().uuid(), points: z.number().int().refine((x) => x !== 0 && Math.abs(x) <= 100000, 'Points must be non-zero and at most 100,000.'), reason, key: z.string().min(8).max(80).optional() }).parse(req.body);
    return ctx.db.asService(async (q) => {
      const target = (await q.query('select id from users where id = $1', [b.userId])).rows[0];
      if (!target) throw notFound('User');
      const key = `adjust:${b.userId}:${b.key ?? Date.now()}`;
      const r = await q.query(`insert into loyalty_ledger(user_id,kind,points,reason,created_by,idempotency_key) values ($1,'adjust',$2,$3,$4,$5) on conflict (idempotency_key) do nothing returning id`, [b.userId, b.points, b.reason, u.id, key]);
      await audit(q, u.id, 'loyalty.adjust', 'user', b.userId, b.reason, { points: b.points });
      return { entryId: r.rows[0]?.id ?? null, balance: await getBalance(q, b.userId) };
    }, u.id);
  });

  // ── orders, disputes, reports (support has a limited view)
  app.get('/admin/orders', async (req) => {
    ops(req);
    const f = z.object({ status: z.string().optional(), q: z.string().max(40).optional() }).parse(req.query);
    return asReqUser(ctx, req, async (q) => (await q.query(
      `select o.id, o.order_no, o.status, o.total_minor, o.placed_at, o.payment_method, o.payment_status, s.name_en as store_name_en
       from orders o join stores s on s.id = o.store_id where ($1::text is null or o.status = $1) and ($2::text is null or o.order_no::text = $2) order by o.placed_at desc limit 100`, [f.status ?? null, f.q ?? null])).rows);
  });
  app.get('/admin/orders/:id', async (req) => { ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const d = await asReqUser(ctx, req, (q) => getOrderDetail(q, id)); if (!d) throw notFound('Order'); return d; });
  app.post('/admin/orders/:id/status', async (req) => {
    const u = ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ to: z.enum(['cancelled', 'rejected', 'delivered', 'reviewing', 'preparing', 'ready', 'out_for_delivery', 'received']), reason }).parse(req.body);
    return transitionOrder(ctx, u, id, b.to, undefined, b.reason);
  });
  app.get('/admin/disputes', async (req) => { ops(req); return asReqUser(ctx, req, async (q) => (await q.query(
    `select d.*, o.order_no, o.total_minor, (select json_agg(e order by e.id) from dispute_events e where e.dispute_id = d.id) as events from disputes d join orders o on o.id = d.order_id order by d.created_at desc limit 100`)).rows); });
  app.post('/admin/disputes/:id/review', async (req) => {
    const u = ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query(`update disputes set status = 'under_review' where id = $1 and status = 'open' returning id`, [id]);
      if (!r.rowCount) throw conflict('INVALID_STATE', 'Only open disputes can be taken into review.');
      await q.query(`insert into dispute_events(dispute_id,actor_id,action) values ($1,$2,'under_review')`, [id, u.id]); return { id, status: 'under_review' };
    });
  });
  app.post('/admin/disputes/:id/resolve', async (req) => {
    const u = ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ status: z.enum(['resolved', 'rejected']), resolution: reason, refundMinor: z.number().int().min(0).optional() }).parse(req.body);
    return resolveDispute(ctx, u, id, b.status, b.resolution, b.refundMinor);
  });
  app.get('/admin/reports', async (req) => { ops(req); return asReqUser(ctx, req, async (q) => (await q.query('select * from reports order by status = \'open\' desc, created_at desc limit 100')).rows); });
  app.post('/admin/reports/:id/resolve', async (req) => {
    const u = ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ status: z.enum(['actioned', 'dismissed']), resolution: reason }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query(`update reports set status=$2, resolution=$3, resolved_by=$4, resolved_at=now() where id=$1 and status='open' returning id`, [id, b.status, b.resolution, u.id]);
      if (!r.rowCount) throw conflict('INVALID_STATE', 'This report was already handled.');
      await audit(q, u.id, 'report.resolve', 'report', id, b.resolution, { status: b.status }); return { id, status: b.status };
    });
  });
  /** Moderation access to a REPORTED conversation only (RLS), and every read is audited. */
  app.get('/admin/reports/:id/conversation', async (req) => {
    const u = ops(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      const rep = (await q.query('select * from reports where id = $1', [id])).rows[0];
      if (!rep) throw notFound('Report');
      const convId = rep.target_type === 'conversation' ? rep.target_id : rep.target_type === 'message' ? (await q.query('select conversation_id from messages where id = $1', [rep.target_id])).rows[0]?.conversation_id : null;
      if (!convId) throw unprocessable('NO_CONVERSATION', 'This report is not about a conversation.');
      const msgs = (await q.query(`select id, sender_side, kind, body, ref_type, created_at from messages where conversation_id = $1 order by created_at limit 200`, [convId])).rows;
      await audit(q, u.id, 'moderation.read_conversation', 'conversation', convId, `report ${id}`, { messages: msgs.length });
      return { conversationId: convId, messages: msgs };
    });
  });

  // ── users, products oversight, audit, providers, jobs
  app.get('/admin/users', async (req) => {
    ops(req); const f = z.object({ q: z.string().max(40).optional() }).parse(req.query);
    return asReqUser(ctx, req, async (q) => (await q.query(
      `select id, phone, name, role, status, created_at from users where ($1::text is null or phone like '%' || $1 || '%' or name ilike '%' || $1 || '%') order by created_at desc limit 100`, [f.q ?? null])).rows);
  });
  app.post('/admin/users/:id/status', async (req) => {
    const u = admin(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ status: z.enum(['active', 'restricted']), reason }).parse(req.body);
    return ctx.db.asService(async (q) => {
      const t = (await q.query('select role from users where id = $1', [id])).rows[0];
      if (!t) throw notFound('User');
      if (t.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Administrator accounts cannot be restricted here.');
      await q.query(`update users set status = $2 where id = $1 and status <> 'deleted'`, [id, b.status]);
      await audit(q, u.id, 'user.status', 'user', id, b.reason, { status: b.status }); return { id, status: b.status };
    }, u.id);
  });
  app.get('/admin/products', async (req) => {
    ops(req); const f = z.object({ q: z.string().max(60).optional(), storeId: z.string().uuid().optional() }).parse(req.query);
    return asReqUser(ctx, req, async (q) => (await q.query(
      `select p.id, p.sku, p.name_en, p.name_ar, p.brand, p.price_minor, p.stock_qty, p.active, s.name_en as store_name_en from products p join stores s on s.id = p.store_id
       where ($1::text is null or p.name_en ilike '%' || $1 || '%' or p.sku ilike '%' || $1 || '%') and ($2::uuid is null or p.store_id = $2) order by p.name_en limit 100`, [f.q ?? null, f.storeId ?? null])).rows);
  });
  app.post('/admin/products/:id/active', async (req) => {
    const u = admin(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ active: z.boolean(), reason }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query('update products set active = $2 where id = $1 returning id', [id, b.active]);
      if (!r.rowCount) throw notFound('Product');
      await audit(q, u.id, 'product.active', 'product', id, b.reason, { active: b.active }); return { id, active: b.active };
    });
  });
  app.get('/admin/audit', async (req) => { admin(req); return asReqUser(ctx, req, async (q) => (await q.query(
    `select a.id, a.action, a.entity, a.entity_id, a.reason, a.detail, a.created_at, a.actor_id from audit_logs a order by a.id desc limit 200`)).rows); });
  app.get('/admin/providers', async (req) => {
    admin(req);
    return {
      otp: { mode: ctx.providers.otp.mode }, payments: { mode: ctx.providers.payments.mode, name: ctx.providers.payments.name }, ai: { name: ctx.providers.ai.name },
      transcription: { mode: ctx.providers.transcription.mode }, storage: { name: 'local-filesystem' }, geo: { mode: ctx.providers.geo.mode }, notifications: { name: 'in-app + SSE' },
      secretsConfigured: { aiKey: !!ctx.cfg.anthropicKey, authSecret: true, webhookSecret: true },    // booleans only, never values
    };
  });
  app.post('/admin/jobs/run', async (req) => { const u = admin(req); const stats = await runMaintenance(ctx); await ctx.db.asService((q) => audit(q, u.id, 'jobs.run', 'system', null, null, stats), u.id); return stats; });
}
