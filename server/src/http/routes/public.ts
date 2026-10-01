import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../errors.js';
import type { Ctx } from '../context.js';
import { isEligible } from '../../domain/basketEngine.js';
import { defaultConstraints, type Constraints } from '../../domain/types.js';
import { loadProductsByIds, loadStore, loadProducts, mapProduct } from '../../services/loaders.js';
import { priceLines } from '../../domain/pricing.js';
import { viewLine } from '../../services/basketView.js';
import { getRules } from '../../services/loyalty.js';

function openNow(h: { open: string; close: string }): boolean {
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return h.open <= h.close ? t >= h.open && t < h.close : t >= h.open || t < h.close;
}
export const ConstraintsSchema = z
  .object({
    areaId: z.string().uuid().nullable().optional(),
    household: z.number().int().min(1).max(12).optional(),
    days: z.number().int().min(1).max(62).optional(),
    budgetMinor: z.number().int().min(0).max(10_000_000).nullable().optional(),
    budgetIncludesDelivery: z.boolean().optional(),
    basketType: z
      .enum(['family_weekly', 'budget', 'single', 'monthly', 'baby', 'healthy', 'custom'])
      .optional(),
    diet: z.array(z.string().max(30)).max(10).optional(),
    allergens: z.array(z.string().max(30)).max(10).optional(),
    exclude: z.array(z.string().max(40)).max(20).optional(),
    tier: z.enum(['value', 'standard', 'premium', 'any']).optional(),
    brands: z.array(z.string().max(60)).max(10).optional(),
    mustHave: z.array(z.string().max(60)).max(10).optional(),
    substitutionPolicy: z.enum(['auto', 'ask', 'none']).optional(),
    storeId: z.string().uuid().nullable().optional(),
    includeOptional: z.boolean().optional(),
    baby: z.boolean().optional(),
  })
  .strict();
export const toConstraints = (c: z.infer<typeof ConstraintsSchema> | undefined): Constraints =>
  ({ ...defaultConstraints(), ...(c ?? {}) }) as Constraints;

export function registerPublicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/config', async () => {
    const rules = await ctx.db.asUser(null, (q) => getRules(q));
    return {
      currency: 'AED',
      locales: ['ar', 'en'],
      providers: {
        otp: { mode: ctx.providers.otp.mode },
        payments: {
          mode: ctx.providers.payments.mode,
          name: ctx.providers.payments.name,
          cod: ctx.cfg.codEnabled,
        },
        ai: { name: ctx.providers.ai.name },
        transcription: { mode: ctx.providers.transcription.mode },
        geo: { mode: ctx.providers.geo.mode },
      },
      loyalty: rules,
      autoSubstitutionMaxIncreasePct: ctx.cfg.autoSubMaxIncreasePct,
      sandboxCardTokens:
        ctx.providers.payments.mode === 'sandbox'
          ? ['tok_success', 'tok_decline', 'tok_pending', 'tok_network']
          : [],
    };
  });

  app.get('/areas', async () =>
    ctx.db.asUser(null, async (q) =>
      (
        await q.query(
          `select a.id, a.emirate, a.name_en, a.name_ar, a.lat, a.lng,
            (select count(*)::int from store_areas sa join stores s on s.id = sa.store_id join businesses b on b.id = s.business_id
              where sa.area_id = a.id and s.active and b.status = 'approved') as store_count
     from areas a order by a.emirate, a.name_en`,
        )
      ).rows.map((r) => ({ ...r, served: r.store_count > 0 })),
    ),
  );

  app.post('/areas/nearest', async (req) => {
    const { lat, lng } = z
      .object({ lat: z.number().min(22).max(27), lng: z.number().min(51).max(57) })
      .parse(req.body);
    const areas = await ctx.db.asUser(
      null,
      async (q) => (await q.query('select id, lat, lng from areas')).rows,
    );
    const n = ctx.providers.geo.nearest(lat, lng, areas);
    return n && n.km < 25 ? n : { id: null, km: null }; // coordinates are never stored
  });

  /** Packages are data: the onboarding screen renders whatever the administrator configured. */
  app.get('/packages', async () =>
    ctx.db.asUser(
      null,
      async (q) =>
        (
          await q.query(
            'select id, code, name_en, name_ar, price_minor, billing_interval, trial_days, entitlements from packages where active order by price_minor',
          )
        ).rows,
    ),
  );

  app.get('/categories', async () =>
    ctx.db.asUser(
      null,
      async (q) =>
        (await q.query('select id, code, need_group, name_en, name_ar from categories order by sort_order'))
          .rows,
    ),
  );

  app.get('/stores', async (req) => {
    const { areaId, q: search } = z
      .object({ areaId: z.string().uuid().optional(), q: z.string().max(60).optional() })
      .parse(req.query);
    return ctx.db.asUser(req.user, async (q) => {
      const { rows } = await q.query(
        `select s.id, s.name_en, s.name_ar, s.description_en, s.description_ar, s.cover_image, s.delivery_fee_minor, s.free_delivery_over_minor, s.min_order_minor,
                s.eta_min_minutes, s.eta_max_minutes, s.opening_hours, s.accepts_cod,
                (select coalesce(json_agg(json_build_object('id', a.id, 'name_en', a.name_en, 'name_ar', a.name_ar)), '[]') from store_areas sa join areas a on a.id = sa.area_id where sa.store_id = s.id) as areas
         from stores s join businesses b on b.id = s.business_id
         where s.active and b.status = 'approved'
           and ($1::uuid is null or exists (select 1 from store_areas sa where sa.store_id = s.id and sa.area_id = $1))
           and ($2::text is null or s.name_en ilike '%' || $2 || '%' or s.name_ar ilike '%' || $2 || '%')
         order by s.name_en`,
        [areaId ?? null, search ?? null],
      );
      return rows.map((r) => ({ ...r, open_now: openNow(r.opening_hours) }));
    });
  });

  app.get('/stores/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ctx.db.asUser(req.user, async (q) => {
      const s = (
        await q.query(
          `select s.*, (select coalesce(json_agg(json_build_object('id', a.id, 'name_en', a.name_en, 'name_ar', a.name_ar)), '[]') from store_areas sa join areas a on a.id = sa.area_id where sa.store_id = s.id) as areas
         from stores s where s.id = $1`,
          [id],
        )
      ).rows[0];
      if (!s) throw notFound('Store');
      const cats = (
        await q.query(
          `select c.code, c.need_group, c.name_en, c.name_ar, count(*)::int as n from products p join categories c on c.id = p.category_id
         where p.store_id = $1 and p.active group by c.code, c.need_group, c.name_en, c.name_ar, c.sort_order order by c.sort_order`,
          [id],
        )
      ).rows;
      return { ...s, open_now: openNow(s.opening_hours), categories: cats };
    });
  });

  app.get('/stores/:id/products', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const f = z
      .object({
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(60).default(24),
        q: z.string().max(60).optional(),
        category: z.string().max(40).optional(),
        diet: z.string().max(100).optional(),
        inStock: z.enum(['1', '0']).optional(),
      })
      .parse(req.query);
    const diet = f.diet ? f.diet.split(',').filter(Boolean) : [];
    let after: { n: string; id: string } | null = null;
    if (f.cursor) {
      try {
        after = JSON.parse(Buffer.from(f.cursor, 'base64url').toString());
      } catch {
        after = null;
      }
    }
    return ctx.db.asUser(req.user, async (q) => {
      const { rows } = await q.query(
        `select p.id, p.store_id, c.code as category_code, c.need_group, p.name_en, p.name_ar, p.brand, p.size_label, p.price_minor, p.compare_at_minor, p.stock_qty,
                p.tier, p.dietary, p.allergens, p.image_url, p.substitutable
         from products p join categories c on c.id = p.category_id
         where p.store_id = $1 and p.active
           and ($2::text is null or c.code = $2)
           and ($3::text is null or p.name_en ilike '%' || $3 || '%' or p.name_ar ilike '%' || $3 || '%' or p.brand ilike '%' || $3 || '%')
           and (cardinality($4::text[]) = 0 or p.dietary @> $4::text[])
           and ($5::text is distinct from '1' or p.stock_qty > 0)
           and ($6::text is null or (p.name_en, p.id) > ($6, $7::uuid))
         order by p.name_en, p.id limit $8`,
        [
          id,
          f.category ?? null,
          f.q ?? null,
          diet,
          f.inStock ?? null,
          after?.n ?? null,
          after?.id ?? null,
          f.limit + 1,
        ],
      );
      const page = rows.slice(0, f.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => viewLine(mapProduct(r), 1)),
        nextCursor:
          rows.length > f.limit && last
            ? Buffer.from(JSON.stringify({ n: last.name_en, id: last.id })).toString('base64url')
            : null,
      };
    });
  });

  app.get('/products/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ctx.db.asUser(req.user, async (q) => {
      const [p] = await loadProductsByIds(q, [id]);
      if (!p) throw notFound('Product');
      const extra = (
        await q.query(
          'select description_en, description_ar, country_of_origin from products where id = $1',
          [id],
        )
      ).rows[0];
      return {
        ...viewLine(p, 1),
        storeId: p.storeId,
        description: { en: extra.description_en, ar: extra.description_ar },
        countryOfOrigin: extra.country_of_origin,
      };
    });
  });

  /** Alternatives with the exact money effect of replacing the item at the given quantity. */
  app.get('/products/:id/alternatives', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const f = z
      .object({
        qty: z.coerce.number().int().min(1).max(99).default(1),
        diet: z.string().optional(),
        allergens: z.string().optional(),
        exclude: z.string().optional(),
      })
      .parse(req.query);
    const c: Constraints = {
      ...defaultConstraints(),
      diet: f.diet?.split(',').filter(Boolean) ?? [],
      allergens: f.allergens?.split(',').filter(Boolean) ?? [],
      exclude: f.exclude?.split(',').filter(Boolean) ?? [],
    };
    return ctx.db.asUser(req.user, async (q) => {
      const [orig] = await loadProductsByIds(q, [id]);
      if (!orig) throw notFound('Product');
      const siblings = (await loadProducts(q, [orig.storeId])).filter(
        (p) => p.categoryCode === orig.categoryCode && p.id !== orig.id,
      );
      const mapped = new Set(
        (
          await q.query('select alternative_id from product_alternatives where product_id = $1', [id])
        ).rows.map((r) => r.alternative_id),
      );
      const out = siblings
        .filter((p) => isEligible(p, c) && p.stockQty >= f.qty)
        .map((p) => {
          const diff = (p.priceMinor - orig.priceMinor) * f.qty;
          const kind =
            diff < 0 && Math.abs(diff) > orig.priceMinor * f.qty * 0.1
              ? 'save_more'
              : Math.abs(diff) <= orig.priceMinor * f.qty * 0.1
                ? 'similar_price'
                : 'higher_price';
          const lost = orig.dietary.filter((t) => !p.dietary.includes(t));
          return {
            ...viewLine(p, f.qty),
            kind,
            priceDiffMinor: diff,
            mappedByStore: mapped.has(p.id),
            differences: [
              ...(p.brand !== orig.brand ? [{ field: 'brand', from: orig.brand, to: p.brand }] : []),
              ...(p.sizeLabel !== orig.sizeLabel
                ? [{ field: 'size', from: orig.sizeLabel, to: p.sizeLabel }]
                : []),
              ...(lost.length ? [{ field: 'dietary_lost', from: lost.join(','), to: '' }] : []),
            ],
          };
        });
      out.sort((a, b) => a.priceDiffMinor - b.priceDiffMinor);
      return { original: viewLine(orig, f.qty), alternatives: out };
    });
  });

  app.get('/ready-baskets', async (req) => {
    const { areaId } = z.object({ areaId: z.string().uuid().optional() }).parse(req.query);
    return ctx.db.asUser(req.user, async (q) => {
      const { rows } = await q.query(
        `select rb.id, rb.code, rb.basket_type, rb.name_en, rb.name_ar, rb.description_en, rb.description_ar, rb.household_size, rb.duration_days,
                s.id as store_id, s.name_en as store_name_en, s.name_ar as store_name_ar,
                (select coalesce(sum(i.qty * p.price_minor), 0)::int from ready_basket_items i join products p on p.id = i.product_id where i.ready_basket_id = rb.id) as items_total_minor,
                (select count(*)::int from ready_basket_items i join products p on p.id = i.product_id where i.ready_basket_id = rb.id and p.stock_qty < i.qty) as unavailable_count,
                (select coalesce(json_agg(json_build_object('id', a.id, 'name_en', a.name_en, 'name_ar', a.name_ar)), '[]') from store_areas sa join areas a on a.id = sa.area_id where sa.store_id = s.id) as areas
         from ready_baskets rb join stores s on s.id = rb.store_id join businesses b on b.id = s.business_id
         where rb.active and s.active and b.status = 'approved'
           and ($1::uuid is null or exists (select 1 from store_areas sa where sa.store_id = s.id and sa.area_id = $1))
         order by array_position(array['family_weekly','budget','single','monthly','baby','healthy'], rb.basket_type), s.name_en`,
        [areaId ?? null],
      );
      return rows;
    });
  });

  app.get('/ready-baskets/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ctx.db.asUser(req.user, async (q) => {
      const rb = (await q.query('select * from ready_baskets where id = $1', [id])).rows[0];
      if (!rb) throw notFound('Ready basket');
      const store = await loadStore(q, rb.store_id);
      const items = (
        await q.query('select product_id, qty from ready_basket_items where ready_basket_id = $1', [id])
      ).rows;
      const products = await loadProductsByIds(
        q,
        items.map((i) => i.product_id),
      );
      const byId = new Map(products.map((p) => [p.id, p]));
      const lines = items
        .filter((i) => byId.has(i.product_id))
        .map((i) => viewLine(byId.get(i.product_id)!, i.qty));
      const priced = priceLines(
        lines.map((l) => ({ product: byId.get(l.productId)!, qty: l.qty })),
        store!,
        0,
      );
      return {
        id: rb.id,
        code: rb.code,
        basketType: rb.basket_type,
        name: { en: rb.name_en, ar: rb.name_ar },
        description: { en: rb.description_en, ar: rb.description_ar },
        householdSize: rb.household_size,
        durationDays: rb.duration_days,
        storeId: rb.store_id,
        store: {
          id: store!.id,
          name: { en: store!.nameEn, ar: store!.nameAr },
          deliveryFeeMinor: store!.deliveryFeeMinor,
          freeDeliveryOverMinor: store!.freeDeliveryOverMinor,
          minOrderMinor: store!.minOrderMinor,
        },
        lines,
        totals: priced.totals,
      };
    });
  });
}
