import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, notFound, unprocessable } from '../errors.js';
import { limit, type Ctx } from '../context.js';
import { buildBestBasket, buildBasket } from '../../domain/basketEngine.js';
import { parseRequest, type ParseResult } from '../../domain/nlp.js';
import { ConstraintsSchema, toConstraints } from './public.js';
import {
  loadProducts,
  loadProductsByIds,
  loadRules,
  loadStore,
  loadStoresForArea,
} from '../../services/loaders.js';
import { repriceView, viewBasket } from '../../services/basketView.js';
import { track } from '../../services/common.js';
import { getBalance, getRules } from '../../services/loyalty.js';

export function registerBasketRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Natural-language request -> interpreted constraints. AI is optional; the rules parser always runs first. */
  app.post('/baskets/parse', async (req, reply) => {
    limit(ctx, req, reply, 'parse', 30, 60);
    const { text, source } = z
      .object({
        text: z.string().trim().min(2).max(1500),
        source: z.enum(['natural', 'voice']).default('natural'),
      })
      .parse(req.body);
    const areas = await ctx.db.asUser(null, async (q) =>
      (await q.query('select id, name_en, name_ar from areas')).rows.map((r) => ({
        id: r.id,
        nameEn: r.name_en,
        nameAr: r.name_ar,
      })),
    );
    let result: ParseResult = parseRequest(text, areas);
    let aiUsed = false,
      fallbackUsed = false;
    if (ctx.providers.ai.name !== 'rules') {
      try {
        const extra = await ctx.providers.ai.enhanceParse(text, result);
        if (extra) {
          // AI may only fill what the rules parser could not detect; it never overrides detected values
          const c = { ...result.constraints };
          const detected = new Set(result.detected);
          if (extra.household && !detected.has('household')) {
            c.household = extra.household;
            detected.add('household');
          }
          if (extra.days && !detected.has('days')) {
            c.days = extra.days;
            detected.add('days');
          }
          if (extra.budgetMinor != null && !detected.has('budget')) {
            c.budgetMinor = extra.budgetMinor;
            detected.add('budget');
          }
          if (extra.diet) c.diet = [...new Set([...c.diet, ...extra.diet])];
          if (extra.allergens) c.allergens = [...new Set([...c.allergens, ...extra.allergens])];
          if (extra.exclude) c.exclude = [...new Set([...c.exclude, ...extra.exclude])];
          result = {
            ...result,
            constraints: c,
            detected: [...detected],
            needsConfirmation: result.needsConfirmation.filter(
              (n) =>
                !(n === 'household' && detected.has('household')) &&
                !(n === 'days' && detected.has('days')) &&
                !(n === 'budget' && detected.has('budget')),
            ),
          };
          aiUsed = true;
        }
      } catch {
        fallbackUsed = true;
      } // provider failure => deterministic rules result is used as-is
    }
    await ctx.db.asService((q) =>
      track(q, req.user?.id ?? null, 'basket_parse', { source, aiUsed, fallbackUsed, corrected: false }),
    );
    return { ...result, ai: { provider: ctx.providers.ai.name, used: aiUsed, fallbackUsed } };
  });

  app.post('/baskets/generate', async (req, reply) => {
    limit(ctx, req, reply, 'generate', 40, 60);
    const t0 = Date.now();
    const body = z
      .object({
        constraints: ConstraintsSchema,
        source: z.enum(['guided', 'natural', 'voice']).default('guided'),
        budgetScopeConfirmed: z.boolean().optional(),
        fallbackUsed: z.boolean().optional(),
      })
      .parse(req.body);
    const c = toConstraints(body.constraints);
    if (!c.areaId)
      throw unprocessable(
        'AREA_REQUIRED',
        'Choose your area first so we can use stores that deliver to you.',
      );
    if (c.budgetMinor != null && body.budgetScopeConfirmed !== true) {
      throw unprocessable(
        'BUDGET_SCOPE_REQUIRED',
        'Tell us whether your budget includes delivery or covers products only.',
      );
    }
    if (c.budgetMinor != null && c.budgetMinor < 1000)
      throw unprocessable(
        'BUDGET_TOO_LOW',
        'Budgets below AED 10 cannot cover a basket. Increase the budget to continue.',
      );
    const data = await ctx.db.asUser(req.user, async (q) => {
      let stores = await loadStoresForArea(q, c.areaId!);
      if (c.storeId) stores = stores.filter((s) => s.id === c.storeId);
      if (!stores.length) {
        const served = (
          await q.query(
            `select distinct a.id, a.name_en, a.name_ar from areas a join store_areas sa on sa.area_id = a.id join stores s on s.id = sa.store_id join businesses b on b.id = s.business_id
           where s.active and b.status = 'approved' order by a.name_en`,
          )
        ).rows;
        throw unprocessable(
          'UNSUPPORTED_AREA',
          'We do not deliver baskets to this area yet. Choose a supported area or join the waiting list.',
          { servedAreas: served },
        );
      }
      const products = await loadProducts(
        q,
        stores.map((s) => s.id),
      );
      const rules = await loadRules(q);
      return { stores, products, rules };
    });
    const best = buildBestBasket({ constraints: c, ...data });
    if (!best) throw unprocessable('NO_STORE', 'No store could build this basket.');
    const view = viewBasket(best, data.products);
    const genId = await ctx.db.asService(async (q) => {
      const r = await q.query(
        `insert into basket_generations(user_id,store_id,source,engine,fallback_used,constraints,result) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          req.user?.id ?? null,
          best.store.id,
          body.source,
          'rules',
          body.fallbackUsed ?? false,
          JSON.stringify(c),
          JSON.stringify({
            lines: view.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
            totals: view.totals,
            facts: view.facts,
          }),
        ],
      );
      await track(q, req.user?.id ?? null, 'basket_generated', {
        source: body.source,
        ms: Date.now() - t0,
        budgetState: view.budget.state,
        complete: view.complete,
        fallbackUsed: body.fallbackUsed ?? false,
        readyOrCustom: 'custom',
      });
      return r.rows[0].id as string;
    });
    const recovery =
      view.shortfallMinor > 0 || !view.complete
        ? ['raise_budget', 'reduce_duration', 'reduce_household', 'remove_optional', 'switch_store']
        : [];
    return {
      generationId: genId,
      engine: {
        name: 'rules',
        note: 'Deterministic rules engine; products and prices come from current store data.',
      },
      compared: best.compared,
      ...view,
      recovery,
    };
  });

  /** Reprice after any edit: subtotal, offers, delivery, loyalty, total and budget status are always recomputed server-side. */
  app.post('/baskets/price', async (req, reply) => {
    limit(ctx, req, reply, 'price', 120, 60);
    const b = z
      .object({
        storeId: z.string().uuid(),
        items: z
          .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
          .max(200),
        constraints: ConstraintsSchema.optional(),
        loyaltyPoints: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    const c = toConstraints(b.constraints);
    return ctx.db.asUser(req.user, async (q) => {
      const store = await loadStore(q, b.storeId);
      if (!store) throw notFound('Store');
      const products = await loadProductsByIds(
        q,
        b.items.map((i) => i.productId),
      );
      let loyaltyMinor = 0,
        loyaltyInfo: unknown = null;
      if (b.loyaltyPoints && req.user) {
        const rules = await getRules(q);
        const bal = await getBalance(q, req.user.id);
        const pts = Math.min(b.loyaltyPoints, bal.available);
        loyaltyMinor = pts * rules.pointValueMinor;
        loyaltyInfo = { applied: pts, available: bal.available };
      }
      const view = await repriceView(q, store, products, b.items, c, loyaltyMinor);
      return { ...view, loyalty: loyaltyInfo };
    });
  });

  /** Rebuild only the "essentials" view of a basket for one store (used by "switch store"). */
  app.post('/baskets/compare-stores', async (req, reply) => {
    limit(ctx, req, reply, 'generate', 40, 60);
    const b = z
      .object({ constraints: ConstraintsSchema, budgetScopeConfirmed: z.boolean().optional() })
      .parse(req.body);
    const c = toConstraints(b.constraints);
    if (!c.areaId) throw unprocessable('AREA_REQUIRED', 'Choose your area first.');
    return ctx.db.asUser(req.user, async (q) => {
      const stores = await loadStoresForArea(q, c.areaId!);
      const products = await loadProducts(
        q,
        stores.map((s) => s.id),
      );
      const rules = await loadRules(q);
      return stores.map((s) => {
        const r = buildBasket({ constraints: c, store: s, products, rules });
        return {
          storeId: s.id,
          name: { en: s.nameEn, ar: s.nameAr },
          totalMinor: r.totals.totalMinor,
          deliveryFeeMinor: r.totals.deliveryFeeMinor,
          budgetState: r.budget.state,
          complete: r.complete,
          lines: r.lines.length,
        };
      });
    });
  });

  app.post('/analytics', async (req, reply) => {
    limit(ctx, req, reply, 'analytics', 120, 60);
    const b = z
      .object({
        name: z.enum([
          'basket_started',
          'basket_modified',
          'checkout_started',
          'basket_saved',
          'ready_basket_opened',
          'parse_corrected',
          'substitute_viewed',
          'language_switched',
        ]),
        props: z.record(z.union([z.string().max(80), z.number(), z.boolean()])).default({}),
      })
      .parse(req.body);
    await ctx.db.asService(async (q) => {
      await track(q, req.user?.id ?? null, b.name, b.props);
      if (b.name === 'basket_modified' && typeof b.props.generationId === 'string' && req.user) {
        await q.query(
          'update basket_generations set corrected_by_user = true where id = $1 and user_id = $2',
          [b.props.generationId, req.user.id],
        );
      }
    });
    return { ok: true };
  });

  app.get('/baskets/generations/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await ctx.db.asUser(
      req.user,
      async (q) =>
        (
          await q.query('select id, constraints, result, created_at from basket_generations where id = $1', [
            id,
          ])
        ).rows[0],
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Basket was not found.');
    return row;
  });
}
