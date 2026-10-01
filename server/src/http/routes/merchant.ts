import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { limit, requireRole, type Ctx } from '../context.js';
import type { Q } from '../../db.js';
import { getOrderDetail, reportUnavailable, transitionOrder } from '../../services/orders.js';
import { audit } from '../../services/common.js';

/** Current package entitlements for a business (data-driven, never hard-coded in routes). */
export async function entitlements(q: Q, businessId: string) {
  const r = (await q.query(
    `select p.code, p.entitlements, p.name_en, p.name_ar from businesses b join packages p on p.id = b.package_id where b.id = $1`, [businessId])).rows[0];
  return r ?? { code: null, entitlements: { max_products: 0, max_ready_baskets: 0, staff_seats: 0, messages_per_day: 0, analytics: 'none', max_stores: 0 } };
}
async function usage(q: Q, businessId: string) {
  const r = (await q.query(
    `select (select count(*)::int from products p join stores s on s.id = p.store_id where s.business_id = $1 and p.active) as products,
            (select count(*)::int from ready_baskets rb join stores s on s.id = rb.store_id where s.business_id = $1 and rb.active) as ready_baskets,
            (select count(*)::int from business_members where business_id = $1 and member_role = 'staff') as staff,
            (select count(*)::int from stores where business_id = $1) as stores`, [businessId])).rows[0];
  return r as { products: number; ready_baskets: number; staff: number; stores: number };
}
function limitError(what: string, max: number) {
  return new AppError(403, 'PACKAGE_LIMIT_REACHED', `Your package allows ${max} ${what} and you have reached it. Upgrade your package or remove something to continue.`, { what, limit: max });
}

/** The caller's business + role. Staff only see what their permissions allow. */
async function myBusiness(q: Q, userId: string, businessId?: string) {
  const r = (await q.query(
    `select b.*, m.member_role, m.permissions from business_members m join businesses b on b.id = m.business_id
     where m.user_id = $1 and ($2::uuid is null or b.id = $2) order by b.created_at limit 1`, [userId, businessId ?? null])).rows[0];
  if (!r) throw new AppError(404, 'NO_BUSINESS', 'No business is linked to your account yet. Start onboarding to create your store.');
  return r as any;
}
const can = (b: any, perm: string) => b.member_role === 'owner' || (b.permissions as string[]).includes(perm);
const need = (b: any, perm: string) => { if (!can(b, perm)) throw forbidden('Your staff permissions do not include this.'); };

const ProductBody = z.object({
  categoryCode: z.string().max(40), sku: z.string().trim().min(1).max(40), nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(60), sizeLabel: z.string().trim().min(1).max(40), priceMinor: z.number().int().min(1).max(10_000_000),
  compareAtMinor: z.number().int().min(2).nullable().optional(), stockQty: z.number().int().min(0).max(100000),
  tier: z.enum(['value', 'standard', 'premium']).default('standard'), dietary: z.array(z.string().max(30)).max(10).default([]),
  allergens: z.array(z.string().max(30)).max(10).default([]), countryOfOrigin: z.string().max(60).nullable().optional(),
  substitutable: z.boolean().default(true), active: z.boolean().default(true), imageUrl: z.string().max(300).nullable().optional(),
  descriptionEn: z.string().max(500).nullable().optional(), descriptionAr: z.string().max(500).nullable().optional(),
});

export function registerMerchantRoutes(app: FastifyInstance, ctx: Ctx) {
  const m = (req: any) => requireRole(req, 'merchant');

  app.get('/merchant/me', async (req) => {
    const u = m(req);
    return ctx.db.asUser(u, async (q) => {
      const rows = (await q.query(
        `select b.id, b.name_en, b.name_ar, b.status, b.review_note, b.trade_license_no, b.contact_phone, b.package_id, mm.member_role, mm.permissions
         from business_members mm join businesses b on b.id = mm.business_id where mm.user_id = $1 order by b.created_at`, [u.id])).rows;
      const out = [];
      for (const b of rows) {
        const stores = (await q.query('select * from stores where business_id = $1 order by created_at', [b.id])).rows;
        for (const s of stores) s.areas = (await q.query('select area_id from store_areas where store_id = $1', [s.id])).rows.map((r) => r.area_id);
        out.push({ ...b, stores, package: await entitlements(q, b.id), usage: await usage(q, b.id) });
      }
      return { businesses: out };
    });
  });

  // ── onboarding: business profile -> store -> package -> submit for verification
  app.post('/merchant/onboard', async (req, reply) => {
    const u = m(req);
    const b = z.object({
      nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120), tradeLicenseNo: z.string().trim().min(4).max(40), contactPhone: z.string().trim().min(6).max(20),
      packageCode: z.string().max(40),
      store: z.object({ nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120), descriptionEn: z.string().max(500).optional(), descriptionAr: z.string().max(500).optional(),
        deliveryFeeMinor: z.number().int().min(0).max(100000).default(1000), freeDeliveryOverMinor: z.number().int().min(1).nullable().default(null), minOrderMinor: z.number().int().min(0).default(0),
        areaIds: z.array(z.string().uuid()).min(1).max(20) }),
    }).parse(req.body);
    const out = await ctx.db.asService(async (q) => {
      const owned = await q.query(`select 1 from business_members where user_id = $1 and member_role = 'owner'`, [u.id]);
      if (owned.rowCount) throw conflict('BUSINESS_EXISTS', 'You already have a business. Open the dashboard to manage it.');
      const pkg = (await q.query('select * from packages where code = $1 and active', [b.packageCode])).rows[0];
      if (!pkg) throw unprocessable('PACKAGE_NOT_FOUND', 'Choose one of the available packages.');
      const biz = (await q.query(
        `insert into businesses(owner_id,name_en,name_ar,trade_license_no,contact_phone,status,package_id) values ($1,$2,$3,$4,$5,'pending',$6) returning id`,
        [u.id, b.nameEn, b.nameAr, b.tradeLicenseNo, b.contactPhone, pkg.id])).rows[0];
      await q.query(`insert into business_members(business_id,user_id,member_role) values ($1,$2,'owner')`, [biz.id, u.id]);
      await q.query(`insert into subscriptions(business_id,package_id,status,trial_ends_at) values ($1,$2,$3, case when $4 > 0 then now() + make_interval(days => $4) end)`,
        [biz.id, pkg.id, pkg.trial_days > 0 ? 'trial' : 'active', pkg.trial_days]);
      const st = (await q.query(
        `insert into stores(business_id,name_en,name_ar,description_en,description_ar,cover_image,delivery_fee_minor,free_delivery_over_minor,min_order_minor) values ($1,$2,$3,$4,$5,'/img/store-cover.svg',$6,$7,$8) returning id`,
        [biz.id, b.store.nameEn, b.store.nameAr, b.store.descriptionEn ?? null, b.store.descriptionAr ?? null, b.store.deliveryFeeMinor, b.store.freeDeliveryOverMinor, b.store.minOrderMinor])).rows[0];
      for (const a of b.store.areaIds) await q.query('insert into store_areas(store_id,area_id) values ($1,$2) on conflict do nothing', [st.id, a]);
      return { businessId: biz.id, storeId: st.id, status: 'pending' };
    }, u.id);
    return reply.status(201).send(out);
  });

  app.put('/merchant/store/:id', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({
      nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120), descriptionEn: z.string().max(500).nullable().optional(), descriptionAr: z.string().max(500).nullable().optional(),
      deliveryFeeMinor: z.number().int().min(0).max(100000), freeDeliveryOverMinor: z.number().int().min(1).nullable(), minOrderMinor: z.number().int().min(0),
      etaMinMinutes: z.number().int().min(10).max(600), etaMaxMinutes: z.number().int().min(10).max(1200), acceptsCod: z.boolean(), active: z.boolean(),
      openingHours: z.object({ open: z.string().regex(/^\d\d:\d\d$/), close: z.string().regex(/^\d\d:\d\d$/) }), areaIds: z.array(z.string().uuid()).min(1).max(30),
    }).refine((x) => x.etaMaxMinutes >= x.etaMinMinutes, { message: 'Maximum delivery time must be at least the minimum.' }).parse(req.body);
    return ctx.db.asUser(u, async (q) => {
      const r = await q.query(
        `update stores set name_en=$2,name_ar=$3,description_en=$4,description_ar=$5,delivery_fee_minor=$6,free_delivery_over_minor=$7,min_order_minor=$8,
           eta_min_minutes=$9,eta_max_minutes=$10,accepts_cod=$11,active=$12,opening_hours=$13 where id=$1 returning id`,
        [id, b.nameEn, b.nameAr, b.descriptionEn ?? null, b.descriptionAr ?? null, b.deliveryFeeMinor, b.freeDeliveryOverMinor, b.minOrderMinor, b.etaMinMinutes, b.etaMaxMinutes, b.acceptsCod, b.active, JSON.stringify(b.openingHours)]);
      if (!r.rowCount) throw notFound('Store');           // RLS: only owners of that business can update
      await q.query('delete from store_areas where store_id = $1', [id]);
      for (const a of b.areaIds) await q.query('insert into store_areas(store_id,area_id) values ($1,$2)', [id, a]);
      return { ok: true };
    });
  });

  // ── catalog (RLS: catalog permission + writable business; package limits enforced here)
  app.get('/merchant/products', async (req) => {
    const u = m(req);
    const f = z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id); need(b, 'catalog');
      const { rows } = await q.query(
        `select p.*, c.code as category_code, c.name_en as category_name_en, c.name_ar as category_name_ar from products p join categories c on c.id = p.category_id join stores s on s.id = p.store_id
         where s.business_id = $1 and ($2::text is null or p.name_en ilike '%' || $2 || '%' or p.name_ar ilike '%' || $2 || '%' or p.sku ilike '%' || $2 || '%')
         order by c.sort_order, p.name_en limit $3 offset $4`, [b.id, f.q ?? null, f.limit, f.offset]);
      return { items: rows, usage: await usage(q, b.id), package: await entitlements(q, b.id) };
    });
  });

  const writeProduct = async (q: Q, storeId: string, b: z.infer<typeof ProductBody>, id?: string) => {
    const cat = (await q.query('select id from categories where code = $1', [b.categoryCode])).rows[0];
    if (!cat) throw unprocessable('CATEGORY_NOT_FOUND', 'Choose a valid category.');
    if (b.compareAtMinor != null && b.compareAtMinor <= b.priceMinor) throw unprocessable('INVALID_OFFER', 'An offer needs a previous price that is higher than the current price. Offers must be real discounts.');
    const vals = [b.sku, b.nameEn, b.nameAr, b.brand, b.sizeLabel, b.priceMinor, b.compareAtMinor ?? null, b.stockQty, b.tier, b.dietary, b.allergens, b.countryOfOrigin ?? null, b.substitutable, b.active, b.imageUrl ?? `/img/cat/${b.categoryCode}.svg`, b.descriptionEn ?? null, b.descriptionAr ?? null, cat.id];
    if (id) {
      const r = await q.query(
        `update products set sku=$2,name_en=$3,name_ar=$4,brand=$5,size_label=$6,price_minor=$7,compare_at_minor=$8,stock_qty=$9,tier=$10,dietary=$11,allergens=$12,country_of_origin=$13,
           substitutable=$14,active=$15,image_url=$16,description_en=$17,description_ar=$18,category_id=$19 where id=$1 returning *`, [id, ...vals]);
      if (!r.rows[0]) throw notFound('Product');
      return r.rows[0];
    }
    return (await q.query(
      `insert into products(store_id,sku,name_en,name_ar,brand,size_label,price_minor,compare_at_minor,stock_qty,tier,dietary,allergens,country_of_origin,substitutable,active,image_url,description_en,description_ar,category_id)
       values ($19,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`, [...vals, storeId])).rows[0];
  };

  app.post('/merchant/products', async (req, reply) => {
    const u = m(req);
    limit(ctx, req, reply, 'catalog', 120, 60);
    const b = ProductBody.parse(req.body);
    const storeId = z.object({ storeId: z.string().uuid() }).parse(req.body).storeId;
    const row = await ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id); need(biz, 'catalog');
      const s = (await q.query('select id from stores where id = $1 and business_id = $2', [storeId, biz.id])).rows[0];
      if (!s) throw notFound('Store');
      const ent = (await entitlements(q, biz.id)).entitlements;
      const us = await usage(q, biz.id);
      if (b.active && us.products >= ent.max_products) throw limitError('active products', ent.max_products);
      return writeProduct(q, storeId, b);
    });
    return reply.status(201).send(row);
  });
  app.put('/merchant/products/:id', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = ProductBody.parse(req.body);
    return ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id); need(biz, 'catalog');
      const cur = (await q.query('select p.active from products p join stores s on s.id = p.store_id where p.id = $1 and s.business_id = $2', [id, biz.id])).rows[0];
      if (!cur) throw notFound('Product');
      if (b.active && !cur.active) {
        const ent = (await entitlements(q, biz.id)).entitlements; const us = await usage(q, biz.id);
        if (us.products >= ent.max_products) throw limitError('active products', ent.max_products);
      }
      return writeProduct(q, '', b, id);
    });
  });
  app.patch('/merchant/products/:id/stock', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ stockQty: z.number().int().min(0).max(100000).optional(), priceMinor: z.number().int().min(1).max(10_000_000).optional() }).parse(req.body);
    return ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id); need(biz, 'catalog');
      // an offer ends automatically when the new price is no longer a real discount
      const r = await q.query(
        `update products set stock_qty = coalesce($2, stock_qty), price_minor = coalesce($3, price_minor),
           compare_at_minor = case when compare_at_minor is not null and compare_at_minor <= coalesce($3, price_minor) then null else compare_at_minor end
         where id = $1 returning id, stock_qty, price_minor, compare_at_minor`, [id, b.stockQty ?? null, b.priceMinor ?? null]);
      if (!r.rows[0]) throw notFound('Product');
      return r.rows[0];
    });
  });
  app.post('/merchant/products/:id/alternatives', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { alternativeIds } = z.object({ alternativeIds: z.array(z.string().uuid()).max(20) }).parse(req.body);
    return ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id); need(biz, 'catalog');
      const own = await q.query('select 1 from products p join stores s on s.id = p.store_id where p.id = $1 and s.business_id = $2', [id, biz.id]);
      if (!own.rowCount) throw notFound('Product');
      await q.query('delete from product_alternatives where product_id = $1', [id]);
      for (const a of alternativeIds) await q.query('insert into product_alternatives(product_id,alternative_id) values ($1,$2)', [id, a]);   // RLS rejects cross-tenant ids
      return { ok: true, count: alternativeIds.length };
    });
  });

  // ── ready baskets
  app.get('/merchant/ready-baskets', async (req) => {
    const u = m(req);
    return ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id); need(b, 'catalog');
      return (await q.query(
        `select rb.*, (select json_agg(json_build_object('productId', i.product_id, 'qty', i.qty)) from ready_basket_items i where i.ready_basket_id = rb.id) as items
         from ready_baskets rb join stores s on s.id = rb.store_id where s.business_id = $1 order by rb.code`, [b.id])).rows;
    });
  });
  app.post('/merchant/ready-baskets', async (req, reply) => {
    const u = m(req);
    const b = z.object({
      storeId: z.string().uuid(), code: z.string().trim().min(2).max(40), basketType: z.enum(['family_weekly', 'budget', 'single', 'monthly', 'baby', 'healthy']),
      nameEn: z.string().trim().min(2).max(120), nameAr: z.string().trim().min(2).max(120), descriptionEn: z.string().max(300).nullable().optional(), descriptionAr: z.string().max(300).nullable().optional(),
      householdSize: z.number().int().min(1).max(12), durationDays: z.number().int().min(1).max(62), items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) })).min(1).max(100),
    }).parse(req.body);
    const row = await ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id); need(biz, 'catalog');
      const own = await q.query('select 1 from stores where id = $1 and business_id = $2', [b.storeId, biz.id]);
      if (!own.rowCount) throw notFound('Store');
      const ent = (await entitlements(q, biz.id)).entitlements; const us = await usage(q, biz.id);
      if (us.ready_baskets >= ent.max_ready_baskets) throw limitError('ready baskets', ent.max_ready_baskets);
      const rb = (await q.query(
        `insert into ready_baskets(store_id,code,basket_type,name_en,name_ar,description_en,description_ar,household_size,duration_days) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [b.storeId, b.code, b.basketType, b.nameEn, b.nameAr, b.descriptionEn ?? null, b.descriptionAr ?? null, b.householdSize, b.durationDays])).rows[0];
      for (const it of b.items) await q.query('insert into ready_basket_items(ready_basket_id,product_id,qty) values ($1,$2,$3)', [rb.id, it.productId, it.qty]);
      return rb;
    });
    return reply.status(201).send(row);
  });
  app.delete('/merchant/ready-baskets/:id', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ctx.db.asUser(u, async (q) => { const r = await q.query('delete from ready_baskets where id = $1', [id]); if (!r.rowCount) throw notFound('Ready basket'); return { ok: true }; });
  });

  // ── orders
  app.get('/merchant/orders', async (req) => {
    const u = m(req);
    const f = z.object({ status: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    return ctx.db.asUser(u, async (q) => {
      const statuses = f.status ? f.status.split(',') : null;
      return (await q.query(
        `select o.id, o.order_no, o.status, o.total_minor, o.subtotal_minor, o.placed_at, o.payment_method, o.payment_status, o.address->>'contactName' as customer_name, o.substitution_policy,
                (select count(*)::int from order_items i where i.order_id = o.id and i.status = 'ok') as item_count,
                exists (select 1 from substitution_requests sr where sr.order_id = o.id and sr.status = 'pending') as has_pending_substitution
         from orders o where o.status <> 'pending_payment' and ($1::text[] is null or o.status = any($1)) order by o.placed_at desc limit $2`, [statuses, f.limit])).rows;
    });
  });
  app.get('/merchant/orders/:id', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = await ctx.db.asUser(u, (q) => getOrderDetail(q, id));
    if (!d) throw notFound('Order');
    return d;
  });
  app.post('/merchant/orders/:id/status', async (req) => {
    const u = m(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ to: z.enum(['reviewing', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled']), note: z.string().max(300).optional() }).parse(req.body);
    return transitionOrder(ctx, u, id, b.to, b.note);
  });
  app.post('/merchant/orders/:id/items/:itemId/unavailable', async (req) => {
    const u = m(req);
    const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(req.params);
    const b = z.object({ proposedProductId: z.string().uuid().nullable().optional(), reason: z.string().max(300).optional() }).parse(req.body ?? {});
    return reportUnavailable(ctx, u, id, itemId, b.proposedProductId ?? null, b.reason);
  });

  // ── staff
  app.get('/merchant/staff', async (req) => {
    const u = m(req);
    return ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id);
      if (b.member_role !== 'owner') throw forbidden('Only the owner can manage staff.');
      const members = (await q.query(`select mm.user_id, mm.member_role, mm.permissions from business_members mm where mm.business_id = $1`, [b.id])).rows;
      const phones = (await ctx.db.service.query('select id, name, phone from users where id = any($1::uuid[])', [members.map((x) => x.user_id)])).rows;
      return members.map((x) => ({ ...x, name: phones.find((p) => p.id === x.user_id)?.name ?? null, phone: phones.find((p) => p.id === x.user_id)?.phone ?? null }));
    });
  });
  app.post('/merchant/staff', async (req, reply) => {
    const u = m(req);
    const b = z.object({ phone: z.string().min(8).max(20), permissions: z.array(z.enum(['catalog', 'orders', 'conversations', 'reports'])).min(1) }).parse(req.body);
    const { normalizeUaePhone } = await import('../security.js');
    const phone = normalizeUaePhone(b.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid UAE mobile number.');
    const out = await ctx.db.asUser(u, async (q) => {
      const biz = await myBusiness(q, u.id);
      if (biz.member_role !== 'owner') throw forbidden('Only the owner can manage staff.');
      const ent = (await entitlements(q, biz.id)).entitlements; const us = await usage(q, biz.id);
      if (us.staff >= ent.staff_seats) throw limitError('staff seats', ent.staff_seats);
      const target = (await ctx.db.service.query(`select id, role from users where phone = $1 and status = 'active'`, [phone])).rows[0];
      if (!target || target.role !== 'merchant') throw unprocessable('STAFF_NOT_FOUND', 'That person must first sign up with a business account using this number.');
      await q.query(`insert into business_members(business_id,user_id,member_role,permissions) values ($1,$2,'staff',$3) on conflict (business_id,user_id) do update set permissions = excluded.permissions`, [biz.id, target.id, b.permissions]);
      return { userId: target.id };
    });
    return reply.status(201).send(out);
  });
  app.delete('/merchant/staff/:userId', async (req) => {
    const u = m(req);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    return ctx.db.asUser(u, async (q) => { const r = await q.query(`delete from business_members where user_id = $1`, [userId]); if (!r.rowCount) throw notFound('Staff member'); return { ok: true }; });
  });

  // ── package + reports + export
  app.get('/merchant/package', async (req) => {
    const u = m(req);
    return ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id);
      const available = (await q.query('select id, code, name_en, name_ar, price_minor, billing_interval, trial_days, entitlements from packages where active order by price_minor')).rows;
      const sub = (await q.query('select status, trial_ends_at, started_at from subscriptions where business_id = $1 order by started_at desc limit 1', [b.id])).rows[0] ?? null;
      return { current: await entitlements(q, b.id), usage: await usage(q, b.id), subscription: sub, available, businessStatus: b.status };
    });
  });
  app.post('/merchant/package', async (req) => {
    const u = m(req);
    const { packageCode } = z.object({ packageCode: z.string().max(40) }).parse(req.body);
    return ctx.db.asService(async (q) => {
      const b = (await q.query(`select b.id, b.status from businesses b join business_members mm on mm.business_id = b.id where mm.user_id = $1 and mm.member_role = 'owner'`, [u.id])).rows[0];
      if (!b) throw notFound('Business');
      const pkg = (await q.query('select * from packages where code = $1 and active', [packageCode])).rows[0];
      if (!pkg) throw unprocessable('PACKAGE_NOT_FOUND', 'Choose one of the available packages.');
      const us = await usage(q, b.id);
      const ent = pkg.entitlements;
      const over = [['active products', us.products, ent.max_products], ['ready baskets', us.ready_baskets, ent.max_ready_baskets], ['staff seats', us.staff, ent.staff_seats], ['stores', us.stores, ent.max_stores]].filter(([, used, max]) => (used as number) > (max as number));
      if (over.length) {   // downgrade is blocked, with an explanation of exactly what to reduce first
        throw unprocessable('DOWNGRADE_BLOCKED', 'This package cannot hold your current usage. Reduce the items below first.', { over: over.map(([what, used, max]) => ({ what, used, max })) });
      }
      await q.query('update businesses set package_id = $2 where id = $1', [b.id, pkg.id]);
      await q.query(`update subscriptions set status = 'cancelled', ended_at = now() where business_id = $1 and ended_at is null`, [b.id]);
      await q.query(`insert into subscriptions(business_id,package_id,status) values ($1,$2,'active')`, [b.id, pkg.id]);
      await audit(q, u.id, 'package.change', 'business', b.id, null, { to: pkg.code });
      return { ok: true, package: pkg.code };
    }, u.id);
  });

  app.get('/merchant/reports', async (req) => {
    const u = m(req);
    return ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id); need(b, 'reports');
      const ent = (await entitlements(q, b.id)).entitlements;
      const basic = (await q.query(
        `select count(*) filter (where status = 'delivered')::int as delivered_orders, count(*) filter (where status in ('cancelled','rejected'))::int as cancelled_orders,
                coalesce(sum(total_minor) filter (where status = 'delivered'), 0)::int as revenue_minor, coalesce(avg(total_minor) filter (where status = 'delivered'), 0)::int as avg_order_minor
         from orders where business_id = $1 and placed_at > now() - interval '30 days'`, [b.id])).rows[0];
      const out: any = { window: '30d', ...basic, analytics: ent.analytics };
      if (ent.analytics === 'advanced') {
        out.topProducts = (await q.query(
          `select i.name_en, i.name_ar, sum(i.qty)::int as units from order_items i join orders o on o.id = i.order_id where o.business_id = $1 and o.status = 'delivered' and i.status = 'ok' and o.placed_at > now() - interval '30 days' group by 1,2 order by units desc limit 5`, [b.id])).rows;
        out.substitutionRate = (await q.query(
          `select coalesce(round(100.0 * count(*) filter (where sr.status in ('accepted','auto_applied')) / nullif(count(*),0)), 0)::int as accepted_pct, count(*)::int as requests
           from substitution_requests sr join orders o on o.id = sr.order_id where o.business_id = $1`, [b.id])).rows[0];
        out.avgResponseMinutes = (await q.query(
          `select coalesce(round(avg(extract(epoch from (h.created_at - o.placed_at)) / 60)::numeric, 1), 0)::float as v from orders o join order_status_history h on h.order_id = o.id and h.to_status = 'reviewing' where o.business_id = $1`, [b.id])).rows[0].v;
      }
      return out;
    });
  });
  app.get('/merchant/export', async (req, reply) => {
    const u = m(req);
    const data = await ctx.db.asUser(u, async (q) => {
      const b = await myBusiness(q, u.id); need(b, 'reports');
      return {
        exportedAt: new Date().toISOString(), business: { id: b.id, name_en: b.name_en, name_ar: b.name_ar, status: b.status },
        products: (await q.query('select p.* from products p join stores s on s.id = p.store_id where s.business_id = $1', [b.id])).rows,
        orders: (await q.query(`select o.id, o.order_no, o.status, o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.placed_at, (select json_agg(i) from order_items i where i.order_id = o.id) as items from orders o where o.business_id = $1 and o.status <> 'pending_payment'`, [b.id])).rows,
      };
    });
    return reply.header('content-disposition', 'attachment; filename="business-export.json"').send(data);
  });
}
