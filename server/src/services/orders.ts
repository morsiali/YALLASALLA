import type { Q } from '../db.js';
import type { SessionUser } from '../db.js';
import type { Ctx } from '../http/context.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../http/errors.js';
import { budgetStatus, deliveryFee, priceLines } from '../domain/pricing.js';
import { isEligible } from '../domain/basketEngine.js';
import { defaultConstraints, type Constraints, type EngineProduct } from '../domain/types.js';
import { audit, notify, notifyBusiness, track } from './common.js';
import { loadProductsByIds, loadStore } from './loaders.js';
import * as loyalty from './loyalty.js';

export interface PlaceOrderInput {
  storeId: string;
  items: { productId: string; qty: number }[];
  constraints: Partial<Constraints>;
  address: { addressId?: string; areaId?: string; building?: string; unit?: string; instructions?: string };
  contactName?: string;
  notes?: string;
  paymentMethod: 'cod' | 'sandbox_card';
  paymentToken?: string;
  loyaltyPoints?: number;
  approveOverBudget?: boolean;
  generationId?: string | null;
  reorderOf?: string | null;
}

class Replay extends Error {
  constructor(public orderId: string) {
    super('replay');
  }
}

export async function placeOrder(
  ctx: Ctx,
  user: SessionUser,
  input: PlaceOrderInput,
  idemKey: string,
): Promise<{ orderId: string; replay: boolean }> {
  try {
    return await ctx.db.asService(async (q) => {
      const existing = await q.query(
        'select id from orders where customer_id = $1 and idempotency_key = $2',
        [user.id, idemKey],
      );
      if (existing.rows[0]) return { orderId: existing.rows[0].id as string, replay: true };

      const c: Constraints = { ...defaultConstraints(), ...input.constraints };
      // ── store + delivery address
      const store = await loadStore(q, input.storeId);
      const storeRow = (
        await q.query(
          `select s.*, b.status as biz_status from stores s join businesses b on b.id = s.business_id where s.id = $1`,
          [input.storeId],
        )
      ).rows[0];
      if (!store || !storeRow || !storeRow.active || storeRow.biz_status !== 'approved')
        throw unprocessable('STORE_UNAVAILABLE', 'This store is not accepting orders right now.');

      let areaId = input.address.areaId,
        building = input.address.building,
        unit = input.address.unit,
        instructions = input.address.instructions;
      if (input.address.addressId) {
        const a = (
          await q.query('select * from addresses where id = $1 and user_id = $2', [
            input.address.addressId,
            user.id,
          ])
        ).rows[0];
        if (!a) throw notFound('Address');
        areaId = a.area_id;
        building = a.building;
        unit = a.unit;
        instructions = instructions ?? a.instructions;
      }
      if (!areaId || !building)
        throw unprocessable('ADDRESS_REQUIRED', 'Please add a delivery address (area and building).');
      const served = await q.query('select 1 from store_areas where store_id = $1 and area_id = $2', [
        input.storeId,
        areaId,
      ]);
      if (!served.rowCount) {
        const alt = await q.query(
          `select s.id, s.name_en, s.name_ar from stores s join store_areas sa on sa.store_id = s.id join businesses b on b.id = s.business_id
           where sa.area_id = $1 and s.active and b.status = 'approved'`,
          [areaId],
        );
        throw unprocessable('UNSUPPORTED_AREA', 'This store does not deliver to the selected area.', {
          alternativeStores: alt.rows,
        });
      }

      // ── lock + validate products (server is the source of truth for price and stock)
      const merged = new Map<string, number>();
      for (const it of input.items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
      const products = await loadProductsByIds(q, [...merged.keys()], true);
      const byId = new Map(products.map((p) => [p.id, p]));
      const missing: unknown[] = [];
      for (const [id, qty] of merged) {
        const p = byId.get(id);
        if (!p || p.storeId !== input.storeId)
          throw unprocessable('INVALID_ITEM', 'An item in your basket does not belong to this store.', {
            productId: id,
          });
        if (p.stockQty < qty)
          missing.push({
            productId: id,
            name: { en: p.nameEn, ar: p.nameAr },
            requested: qty,
            available: p.stockQty,
          });
      }
      if (missing.length)
        throw conflict('ITEMS_UNAVAILABLE', 'Some items are no longer available in the quantity you chose.', {
          items: missing,
        });
      const active = await q.query('select id from products where id = any($1::uuid[]) and active', [
        [...merged.keys()],
      ]);
      if (active.rowCount !== merged.size)
        throw conflict('ITEMS_UNAVAILABLE', 'Some items were removed by the store.', {});

      // ── totals (never trust client totals) and loyalty
      const base = priceLines(
        [...merged].map(([id, qty]) => ({ product: byId.get(id)!, qty })),
        store,
        0,
      );
      if (base.totals.belowMinOrder)
        throw unprocessable('BELOW_MIN_ORDER', "The basket is below this store's minimum order.", {
          minOrderMinor: store.minOrderMinor,
          subtotalMinor: base.totals.subtotalMinor,
        });
      let points = 0,
        loyaltyMinor = 0;
      if (input.loyaltyPoints && input.loyaltyPoints > 0) {
        const rules = await loyalty.getRules(q);
        const bal = await loyalty.getBalance(q, user.id);
        points = Math.floor(input.loyaltyPoints);
        loyaltyMinor = points * rules.pointValueMinor;
        const maxMinor = Math.floor((base.totals.subtotalMinor * rules.maxRedeemPctOfSubtotal) / 100);
        if (points < rules.minRedeemPoints)
          throw unprocessable('LOYALTY_INVALID', `Minimum redemption is ${rules.minRedeemPoints} points.`, {
            reason: 'below_min',
            minPoints: rules.minRedeemPoints,
          });
        if (points > bal.available)
          throw unprocessable(
            'LOYALTY_INVALID',
            'You do not have that many available points (pending points cannot be used yet).',
            { reason: 'insufficient', available: bal.available },
          );
        if (loyaltyMinor > maxMinor)
          throw unprocessable(
            'LOYALTY_INVALID',
            `Points can cover at most ${rules.maxRedeemPctOfSubtotal}% of the basket.`,
            { reason: 'above_max', maxMinor },
          );
      }
      const { lines, totals } = priceLines(
        [...merged].map(([id, qty]) => ({ product: byId.get(id)!, qty })),
        store,
        loyaltyMinor,
      );

      // ── budget gate: never exceed without explicit approval
      const bs = budgetStatus(totals, c.budgetMinor, c.budgetIncludesDelivery);
      if (bs.state === 'over' && !input.approveOverBudget) {
        throw conflict(
          'BUDGET_EXCEEDED',
          'The final amount is above your budget. Review the basket or approve the extra amount to continue.',
          {
            overByMinor: bs.overByMinor,
            totalMinor: totals.totalMinor,
            budgetMinor: bs.budgetMinor,
            scope: bs.scope,
          },
        );
      }
      const budgetState = c.budgetMinor == null ? 'none' : bs.state === 'over' ? 'over_approved' : bs.state;

      if (input.paymentMethod === 'cod' && (!ctx.cfg.codEnabled || !storeRow.accepts_cod))
        throw unprocessable(
          'PAYMENT_METHOD_UNAVAILABLE',
          'Cash on delivery is not available for this store.',
        );

      const u = (await q.query('select name, phone from users where id = $1', [user.id])).rows[0];
      const address = {
        contactName: input.contactName ?? u.name ?? '',
        contactPhone: u.phone,
        areaId,
        building,
        unit: unit ?? null,
        instructions: instructions ?? null,
      };
      const isCod = input.paymentMethod === 'cod';
      const ins = await q.query(
        `insert into orders(customer_id,store_id,business_id,status,subtotal_minor,discount_minor,delivery_fee_minor,loyalty_redeemed_minor,loyalty_points_redeemed,total_minor,
           budget_minor,budget_includes_delivery,budget_status,substitution_policy,constraints,address,notes,payment_method,payment_status,idempotency_key,generation_id,reorder_of)
         values ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (customer_id, idempotency_key) do nothing returning id`,
        [
          user.id,
          input.storeId,
          storeRow.business_id,
          isCod ? 'received' : 'pending_payment',
          totals.subtotalMinor,
          totals.deliveryFeeMinor,
          totals.loyaltyMinor,
          points,
          totals.totalMinor,
          c.budgetMinor,
          c.budgetMinor == null ? null : c.budgetIncludesDelivery,
          budgetState,
          c.substitutionPolicy,
          JSON.stringify({ diet: c.diet, allergens: c.allergens, exclude: c.exclude }),
          JSON.stringify(address),
          input.notes ?? null,
          input.paymentMethod,
          isCod ? 'cod_due' : 'pending',
          idemKey,
          input.generationId ?? null,
          input.reorderOf ?? null,
        ],
      );
      if (!ins.rows[0]) {
        const r = await q.query('select id from orders where customer_id = $1 and idempotency_key = $2', [
          user.id,
          idemKey,
        ]);
        throw new Replay(r.rows[0].id);
      }
      const orderId = ins.rows[0].id as string;
      for (const l of lines) {
        const p = byId.get(l.productId)!;
        await q.query(
          `insert into order_items(order_id,product_id,name_en,name_ar,brand,size_label,qty,unit_price_minor,line_total_minor) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orderId,
            p.id,
            p.nameEn,
            p.nameAr,
            p.brand,
            p.sizeLabel,
            l.qty,
            l.unitPriceMinor,
            l.lineTotalMinor,
          ],
        );
        const dec = await q.query(
          'update products set stock_qty = stock_qty - $2 where id = $1 and stock_qty >= $2',
          [p.id, l.qty],
        );
        if (!dec.rowCount) throw conflict('ITEMS_UNAVAILABLE', 'An item just sold out.', {});
      }
      if (points > 0) await loyalty.redeem(q, user.id, orderId, points);

      // ── payment (provider-hosted token only; no raw card data)
      if (isCod) {
        await q.query(
          `insert into payments(order_id,provider,mode,status,amount_minor,idempotency_key) values ($1,'cash','cash','pending',$2,$3)`,
          [orderId, totals.totalMinor, `pay:${orderId}`],
        );
      } else {
        if (!input.paymentToken)
          throw unprocessable('PAYMENT_TOKEN_REQUIRED', 'Select a payment method to continue.');
        let charge;
        try {
          charge = await ctx.providers.payments.charge({
            amountMinor: totals.totalMinor,
            currency: 'AED',
            token: input.paymentToken,
            idempotencyKey: `pay:${user.id}:${idemKey}`,
          });
        } catch {
          throw new AppError(
            503,
            'PAYMENT_UNAVAILABLE',
            'The payment service could not be reached. You have not been charged and your basket is saved. Please try again.',
          );
        }
        if (charge.status === 'failed') {
          throw new AppError(
            402,
            'PAYMENT_FAILED',
            'Your payment was not completed. You have not been charged and your basket is saved. Try another payment method.',
            { reason: charge.failureReason },
          );
        }
        await q.query(
          `insert into payments(order_id,provider,mode,provider_ref,status,amount_minor,idempotency_key) values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            orderId,
            ctx.providers.payments.name,
            ctx.providers.payments.mode,
            charge.ref,
            charge.status === 'succeeded' ? 'succeeded' : 'pending',
            totals.totalMinor,
            `pay:${orderId}`,
          ],
        );
        if (charge.status === 'succeeded') {
          await q.query(`update orders set status = 'received', payment_status = 'paid' where id = $1`, [
            orderId,
          ]);
        }
      }
      const status = (await q.query('select status from orders where id = $1', [orderId])).rows[0].status;
      await track(q, user.id, 'order_placed', {
        orderId,
        totalMinor: totals.totalMinor,
        budgetState,
        reorder: !!input.reorderOf,
        fromGeneration: !!input.generationId,
      });
      if (input.generationId && c.budgetMinor != null) {
        await track(q, user.id, 'budget_variance', { budgetMinor: c.budgetMinor, spendMinor: bs.spendMinor });
      }
      if (status === 'received') await announceNewOrder(ctx, q, orderId);
      return { orderId, replay: false };
    }, user.id);
  } catch (e) {
    if (e instanceof Replay) return { orderId: e.orderId, replay: true };
    throw e;
  }
}

async function announceNewOrder(ctx: Ctx, q: Q, orderId: string) {
  const o = (
    await q.query('select id, order_no, business_id, customer_id from orders where id = $1', [orderId])
  ).rows[0];
  await notifyBusiness(ctx, q, o.business_id, 'orders', 'order_new', { orderId, orderNo: o.order_no });
  await notify(ctx, q, o.customer_id, 'order_received', { orderId, orderNo: o.order_no });
}

/** Called by the signed payment webhook. Idempotent per provider event id. */
export async function applyPaymentEvent(
  ctx: Ctx,
  evt: { eventId: string; ref: string; status: 'succeeded' | 'failed'; payloadHash: string },
): Promise<{ applied: boolean }> {
  return ctx.db.asService(async (q) => {
    const seen = await q.query(
      'insert into payment_events(event_id,payload_hash) values ($1,$2) on conflict do nothing returning event_id',
      [evt.eventId, evt.payloadHash],
    );
    if (!seen.rowCount) return { applied: false };
    const pay = (await q.query('select * from payments where provider_ref = $1 for update', [evt.ref]))
      .rows[0];
    if (!pay) return { applied: false };
    await q.query('update payment_events set payment_id = $2 where event_id = $1', [evt.eventId, pay.id]);
    const order = (await q.query('select * from orders where id = $1 for update', [pay.order_id])).rows[0];
    if (pay.status !== 'pending' || order.status !== 'pending_payment') return { applied: false };
    if (evt.status === 'succeeded') {
      await q.query(`update payments set status = 'succeeded', updated_at = now() where id = $1`, [pay.id]);
      await q.query(`update orders set status = 'received', payment_status = 'paid' where id = $1`, [
        order.id,
      ]);
      await announceNewOrder(ctx, q, order.id);
    } else {
      await q.query(`update payments set status = 'failed', updated_at = now() where id = $1`, [pay.id]);
      await q.query(`update orders set payment_status = 'failed' where id = $1`, [order.id]);
      await cancelEffects(ctx, q, order, 'payment_failed');
      await q.query(`update orders set status = 'cancelled' where id = $1`, [order.id]);
      await notify(ctx, q, order.customer_id, 'order_payment_failed', {
        orderId: order.id,
        orderNo: order.order_no,
      });
    }
    return { applied: true };
  });
}

// ───────────────────────── state transitions ─────────────────────────
const MERCHANT_MOVES: Record<string, string[]> = {
  received: ['reviewing', 'rejected'],
  reviewing: ['preparing', 'rejected', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
};
const CUSTOMER_CANCEL_FROM = new Set(['pending_payment', 'received', 'reviewing']);

async function actorSide(
  q: Q,
  actor: SessionUser,
  order: any,
): Promise<'customer' | 'merchant' | 'admin' | 'support' | null> {
  if (actor.role === 'admin') return 'admin';
  if (actor.role === 'support') return 'support';
  if (order.customer_id === actor.id) return 'customer';
  const m = await q.query(
    `select 1 from business_members where business_id = $1 and user_id = $2 and (member_role = 'owner' or 'orders' = any(permissions))`,
    [order.business_id, actor.id],
  );
  return m.rowCount ? 'merchant' : null;
}

export async function transitionOrder(
  ctx: Ctx,
  actor: SessionUser,
  orderId: string,
  to: string,
  note?: string,
  reason?: string,
) {
  return ctx.db.asService(async (q) => {
    const order = (await q.query('select * from orders where id = $1 for update', [orderId])).rows[0];
    if (!order) throw notFound('Order');
    const side = await actorSide(q, actor, order);
    if (!side) throw notFound('Order'); // do not reveal other tenants' orders
    const from = order.status as string;
    const allowed =
      side === 'customer'
        ? to === 'cancelled' && CUSTOMER_CANCEL_FROM.has(from)
        : side === 'merchant'
          ? (MERCHANT_MOVES[from] ?? []).includes(to)
          : side === 'support'
            ? to === 'cancelled' && !['delivered', 'cancelled', 'rejected'].includes(from)
            : true; // admin: DB trigger still rejects invalid transitions
    if (!allowed) {
      const hint =
        side === 'customer'
          ? 'Orders can only be cancelled before the store starts preparing them.'
          : 'That status change is not allowed from the current status.';
      throw conflict('INVALID_TRANSITION', hint, { from, to });
    }
    if (to === 'preparing') {
      const pend = await q.query(
        `select 1 from substitution_requests where order_id = $1 and status = 'pending'`,
        [orderId],
      );
      if (pend.rowCount)
        throw conflict(
          'SUBSTITUTIONS_PENDING',
          'Waiting for the customer to answer the substitution request before preparing.',
        );
    }
    if (['cancelled', 'rejected'].includes(to))
      await cancelEffects(ctx, q, order, side === 'customer' ? 'customer_cancelled' : 'store_cancelled');
    await q.query('update orders set status = $2 where id = $1', [orderId, to]);
    if (note)
      await q.query(
        `update order_status_history set note = $2 where id = (select max(id) from order_status_history where order_id = $1)`,
        [orderId, note],
      );
    if (to === 'delivered') {
      if (order.payment_status === 'cod_due') {
        await q.query(`update orders set payment_status = 'paid' where id = $1`, [orderId]);
        await q.query(
          `update payments set status = 'succeeded', updated_at = now() where order_id = $1 and mode = 'cash'`,
          [orderId],
        );
      }
      await loyalty.earnForDeliveredOrder(q, order);
    }
    if (side === 'admin' || side === 'support')
      await audit(q, actor.id, 'order.transition', 'order', orderId, reason ?? note ?? null, { from, to });
    await notify(ctx, q, order.customer_id, `order_${to}`, { orderId, orderNo: order.order_no });
    if (side === 'customer')
      await notifyBusiness(ctx, q, order.business_id, 'orders', 'order_cancelled_by_customer', {
        orderId,
        orderNo: order.order_no,
      });
    await track(q, order.customer_id, 'order_status', { orderId, to });
    return { orderId, status: to };
  }, actor.id);
}

/** Restore stock, give redeemed points back, refund prepaid money. */
async function cancelEffects(ctx: Ctx, q: Q, order: any, why: string) {
  const items = (
    await q.query(`select product_id, qty from order_items where order_id = $1 and status = 'ok'`, [order.id])
  ).rows;
  for (const it of items)
    await q.query('update products set stock_qty = stock_qty + $2 where id = $1', [it.product_id, it.qty]);
  await loyalty.reverseRedemption(q, order.id, `Order ${why}`);
  if (order.payment_status === 'paid' && order.payment_method === 'sandbox_card') {
    await refundOrder(ctx, q, order, order.total_minor, why, null);
    await q.query(`update orders set payment_status = 'refunded' where id = $1`, [order.id]);
  }
}

export async function refundOrder(
  ctx: Ctx,
  q: Q,
  order: any,
  amountMinor: number,
  reason: string,
  actorId: string | null,
) {
  const pay = (
    await q.query(
      `select * from payments where order_id = $1 and mode <> 'cash' order by created_at limit 1`,
      [order.id],
    )
  ).rows[0];
  if (pay?.provider_ref)
    await ctx.providers.payments.refund({
      ref: pay.provider_ref,
      amountMinor,
      idempotencyKey: `refund:${order.id}:${amountMinor}:${reason}`,
    });
  await q.query(
    'insert into refunds(order_id,payment_id,amount_minor,reason,created_by) values ($1,$2,$3,$4,$5)',
    [order.id, pay?.id ?? null, amountMinor, reason, actorId],
  );
  if (pay && amountMinor >= order.total_minor)
    await q.query(`update payments set status = 'refunded', updated_at = now() where id = $1`, [pay.id]);
}

// ───────────────────────── substitutions ─────────────────────────
function differences(orig: any, sub: EngineProduct) {
  const d: { field: string; from: string; to: string }[] = [];
  if (orig.brand !== sub.brand) d.push({ field: 'brand', from: orig.brand, to: sub.brand });
  if (orig.size_label !== sub.sizeLabel) d.push({ field: 'size', from: orig.size_label, to: sub.sizeLabel });
  const lost = (orig.dietary as string[]).filter((t) => !sub.dietary.includes(t));
  if (lost.length) d.push({ field: 'dietary_lost', from: lost.join(','), to: '' });
  return d;
}

async function recalcOrder(q: Q, orderId: string) {
  const o = (await q.query('select * from orders where id = $1', [orderId])).rows[0];
  const store = (await loadStore(q, o.store_id))!;
  const sub = Number(
    (
      await q.query(
        `select coalesce(sum(line_total_minor),0) s from order_items where order_id = $1 and status = 'ok'`,
        [orderId],
      )
    ).rows[0].s,
  );
  // a store stock-out must never make the customer pay a higher delivery fee than they agreed to
  const fee = Math.min(o.delivery_fee_minor, deliveryFee(store, sub));
  const loyaltyMinor = Math.min(o.loyalty_redeemed_minor, sub);
  const total = sub + fee - loyaltyMinor;
  let budgetState = o.budget_status;
  if (o.budget_minor != null) {
    const spend = o.budget_includes_delivery ? total : sub;
    budgetState =
      spend > o.budget_minor
        ? 'over_approved'
        : budgetState === 'over_approved'
          ? 'over_approved'
          : spend >= o.budget_minor * 0.95
            ? 'close'
            : 'within';
  }
  await q.query(
    'update orders set subtotal_minor = $2, delivery_fee_minor = $3, loyalty_redeemed_minor = $4, total_minor = $5, budget_status = $6 where id = $1',
    [orderId, sub, fee, loyaltyMinor, total, budgetState],
  );
  return { oldTotal: o.total_minor as number, newTotal: total };
}

async function postConversationEvent(
  ctx: Ctx,
  q: Q,
  order: any,
  body: string,
  kind: 'substitution' | 'system',
  snapshot: object,
) {
  const cu = (await q.query('select name from users where id = $1', [order.customer_id])).rows[0];
  const conv = (
    await q.query(
      `insert into conversations(customer_id,customer_name,store_id,business_id) values ($1,$2,$3,$4)
     on conflict (customer_id, store_id) do update set last_message_at = now() returning id`,
      [order.customer_id, (cu?.name ?? '').split(' ')[0], order.store_id, order.business_id],
    )
  ).rows[0];
  await q.query(
    `insert into messages(conversation_id,sender_side,kind,body,ref_type,ref_id,ref_snapshot) values ($1,'system',$2,$3,'order',$4,$5)`,
    [conv.id, kind, body, order.id, JSON.stringify(snapshot)],
  );
}

export async function reportUnavailable(
  ctx: Ctx,
  actor: SessionUser,
  orderId: string,
  itemId: string,
  proposedProductId: string | null,
  reason?: string,
) {
  return ctx.db.asService(async (q) => {
    const order = (await q.query('select * from orders where id = $1 for update', [orderId])).rows[0];
    if (!order) throw notFound('Order');
    if ((await actorSide(q, actor, order)) !== 'merchant') throw notFound('Order');
    if (!['reviewing', 'preparing'].includes(order.status))
      throw conflict(
        'INVALID_STATE',
        'Items can be reported unavailable while the order is being reviewed or prepared.',
      );
    const item = (
      await q.query(
        `select oi.*, p.dietary, p.allergens, p.substitutable, p.category_id from order_items oi join products p on p.id = oi.product_id where oi.id = $1 and oi.order_id = $2`,
        [itemId, orderId],
      )
    ).rows[0];
    if (!item || item.status !== 'ok') throw notFound('Order item');
    await q.query(`update order_items set status = 'unavailable' where id = $1`, [itemId]);
    await q.query('update products set stock_qty = 0 where id = $1', [item.product_id]); // the store told us it is gone

    const constraints = { ...defaultConstraints(), ...(order.constraints as object) } as Constraints;
    let proposal: EngineProduct | null = null;
    if (proposedProductId) {
      const [p] = await loadProductsByIds(q, [proposedProductId], true);
      if (!p || p.storeId !== order.store_id)
        throw unprocessable('INVALID_SUBSTITUTE', 'The substitute must be an item from the same store.');
      const sameCat =
        (await q.query('select category_id from products where id = $1', [p.id])).rows[0].category_id ===
        item.category_id;
      if (!sameCat)
        throw unprocessable(
          'INVALID_SUBSTITUTE',
          'The substitute must be in the same category as the unavailable item.',
        );
      if (p.stockQty < item.qty)
        throw unprocessable('INVALID_SUBSTITUTE', 'The substitute does not have enough stock.');
      proposal = p;
    }
    const newLine = proposal ? proposal.priceMinor * item.qty : null;
    const diff = proposal ? newLine! - item.line_total_minor : null;
    if (proposal && order.payment_status === 'paid' && diff! > 0) {
      throw unprocessable(
        'SUBSTITUTE_TOO_EXPENSIVE_FOR_PREPAID',
        'This order was paid online, so the substitute cannot cost more than the original item.',
      );
    }

    const policy = order.substitution_policy as 'auto' | 'ask' | 'none';
    const ins = async (status: string, resolvedBy: string | null) =>
      (
        await q.query(
          `insert into substitution_requests(order_id,order_item_id,original_product_id,proposed_product_id,proposed_qty,reason,price_diff_minor,differences,status,resolved_at,resolved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [
            orderId,
            itemId,
            item.product_id,
            proposal?.id ?? null,
            proposal ? item.qty : null,
            reason ?? null,
            diff,
            JSON.stringify(proposal ? differences(item, proposal) : []),
            status,
            status === 'pending' ? null : new Date(),
            resolvedBy,
          ],
        )
      ).rows[0].id as string;

    // 'none' => never substitute: the item is removed (customer is told, totals and any prepaid money are corrected)
    if (policy === 'none') {
      await q.query(`update order_items set status = 'removed' where id = $1`, [itemId]);
      const id = await ins('rejected', null);
      await finishTotals(ctx, q, order, 'item_removed');
      await notify(ctx, q, order.customer_id, 'substitution_removed', { orderId, orderNo: order.order_no });
      return { requestId: id, outcome: 'removed' as const };
    }
    // 'auto' => only within the defined limits (same category, eligible for diet/allergens, price rise <= configured %)
    if (policy === 'auto' && proposal && item.substitutable) {
      const maxIncrease = Math.round((item.line_total_minor * ctx.cfg.autoSubMaxIncreasePct) / 100);
      if (isEligible(proposal, constraints) && diff! <= maxIncrease) {
        const id = await ins('auto_applied', null);
        await applySubstitution(ctx, q, order, item, proposal);
        await notify(ctx, q, order.customer_id, 'substitution_auto_applied', {
          orderId,
          orderNo: order.order_no,
        });
        return { requestId: id, outcome: 'auto_applied' as const };
      }
    }
    // otherwise ask. Never substitute silently when approval is required.
    const id = await ins('pending', null);
    await postConversationEvent(ctx, q, order, reason ?? 'unavailable', 'substitution', {
      requestId: id,
      itemId,
    });
    await notify(ctx, q, order.customer_id, 'substitution_request', {
      orderId,
      orderNo: order.order_no,
      requestId: id,
    });
    return { requestId: id, outcome: 'pending' as const };
  }, actor.id);
}

async function applySubstitution(ctx: Ctx, q: Q, order: any, item: any, sub: EngineProduct) {
  await q.query(`update order_items set status = 'substituted' where id = $1`, [item.id]);
  await q.query(
    `insert into order_items(order_id,product_id,name_en,name_ar,brand,size_label,qty,unit_price_minor,line_total_minor,replaces_item_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      order.id,
      sub.id,
      sub.nameEn,
      sub.nameAr,
      sub.brand,
      sub.sizeLabel,
      item.qty,
      sub.priceMinor,
      sub.priceMinor * item.qty,
      item.id,
    ],
  );
  await q.query('update products set stock_qty = stock_qty - $2 where id = $1 and stock_qty >= $2', [
    sub.id,
    item.qty,
  ]);
  await finishTotals(ctx, q, order, 'substituted');
}

async function finishTotals(ctx: Ctx, q: Q, order: any, why: string) {
  const { oldTotal, newTotal } = await recalcOrder(q, order.id);
  const fresh = (await q.query('select * from orders where id = $1', [order.id])).rows[0];
  if (fresh.payment_status === 'paid' && fresh.payment_method === 'sandbox_card' && newTotal < oldTotal) {
    await refundOrder(ctx, q, { ...fresh, total_minor: oldTotal }, oldTotal - newTotal, why, null);
  }
}

export async function decideSubstitution(
  ctx: Ctx,
  actor: SessionUser,
  orderId: string,
  requestId: string,
  decision: 'accept' | 'reject',
) {
  return ctx.db.asService(async (q) => {
    const order = (await q.query('select * from orders where id = $1 for update', [orderId])).rows[0];
    if (!order || order.customer_id !== actor.id) throw notFound('Order');
    const req = (
      await q.query('select * from substitution_requests where id = $1 and order_id = $2 for update', [
        requestId,
        orderId,
      ])
    ).rows[0];
    if (!req) throw notFound('Substitution request');
    if (req.status !== 'pending')
      throw conflict('ALREADY_DECIDED', 'This substitution was already answered.');
    const item = (
      await q.query(
        `select oi.*, p.dietary from order_items oi join products p on p.id = oi.product_id where oi.id = $1`,
        [req.order_item_id],
      )
    ).rows[0];
    if (decision === 'accept') {
      if (req.proposed_product_id) {
        const [sub] = await loadProductsByIds(q, [req.proposed_product_id], true);
        if (!sub || sub.stockQty < item.qty)
          throw conflict(
            'SUBSTITUTE_GONE',
            'That substitute is no longer available. The store will propose another option.',
          );
        await applySubstitution(ctx, q, order, item, sub);
        await q.query(
          `update substitution_requests set status = 'accepted', resolved_at = now(), resolved_by = $2 where id = $1`,
          [requestId, actor.id],
        );
      } else {
        // no substitute exists: "accept" = continue without the item
        await q.query(`update order_items set status = 'removed' where id = $1`, [item.id]);
        await q.query(
          `update substitution_requests set status = 'accepted', resolved_at = now(), resolved_by = $2 where id = $1`,
          [requestId, actor.id],
        );
        await finishTotals(ctx, q, order, 'item_removed');
      }
    } else {
      await q.query(
        `update substitution_requests set status = 'rejected', resolved_at = now(), resolved_by = $2 where id = $1`,
        [requestId, actor.id],
      );
      if (!req.proposed_product_id) {
        // declining removal of an item that cannot be replaced = the customer does not want a partial order
        await cancelEffects(ctx, q, order, 'customer_cancelled');
        await q.query(`update orders set status = 'cancelled' where id = $1`, [orderId]);
      } else {
        await q.query(`update order_items set status = 'removed' where id = $1`, [item.id]);
        await finishTotals(ctx, q, order, 'item_removed');
      }
    }
    await notifyBusiness(ctx, q, order.business_id, 'orders', 'substitution_answered', {
      orderId,
      orderNo: order.order_no,
      decision,
    });
    await postConversationEvent(ctx, q, order, `substitution_${decision}`, 'system', { requestId });
    await track(q, actor.id, 'substitution_decision', { decision, orderId });
    return { requestId, decision };
  }, actor.id);
}

// ───────────────────────── disputes & refunds ─────────────────────────
export async function resolveDispute(
  ctx: Ctx,
  actor: SessionUser,
  disputeId: string,
  status: 'resolved' | 'rejected',
  resolution: string,
  refundMinor?: number,
) {
  if (actor.role !== 'admin' && actor.role !== 'support') throw forbidden();
  return ctx.db.asService(async (q) => {
    const d = (await q.query('select * from disputes where id = $1 for update', [disputeId])).rows[0];
    if (!d) throw notFound('Dispute');
    if (['resolved', 'rejected'].includes(d.status))
      throw conflict('ALREADY_RESOLVED', 'This dispute is already closed.');
    const order = (await q.query('select * from orders where id = $1', [d.order_id])).rows[0];
    if (refundMinor && refundMinor > 0) {
      if (status !== 'resolved')
        throw unprocessable(
          'REFUND_NEEDS_RESOLUTION',
          "A refund can only be issued when the dispute is resolved in the customer's favour.",
        );
      const already = Number(
        (await q.query('select coalesce(sum(amount_minor),0) s from refunds where order_id = $1', [order.id]))
          .rows[0].s,
      );
      if (already + refundMinor > order.total_minor)
        throw unprocessable('REFUND_TOO_LARGE', 'The refund would exceed the order total.', {
          refundable: order.total_minor - already,
        });
      await refundOrder(ctx, q, order, refundMinor, `dispute:${disputeId}`, actor.id);
      await loyalty.reverseEarn(
        q,
        order.id,
        refundMinor / order.total_minor,
        'Refund issued',
        `dispute:${disputeId}`,
        actor.id,
      );
    }
    await q.query(
      `update disputes set status = $2, resolution = $3, refund_minor = $4, resolved_at = now() where id = $1`,
      [disputeId, status, resolution, refundMinor ?? null],
    );
    await q.query(`insert into dispute_events(dispute_id,actor_id,action,note) values ($1,$2,$3,$4)`, [
      disputeId,
      actor.id,
      status,
      resolution,
    ]);
    await audit(q, actor.id, 'dispute.resolve', 'dispute', disputeId, resolution, {
      status,
      refundMinor: refundMinor ?? 0,
      orderId: order.id,
    });
    await notify(ctx, q, d.opened_by, 'dispute_resolved', { disputeId, orderNo: order.order_no, status });
    return { disputeId, status };
  }, actor.id);
}

// ───────────────────────── read model ─────────────────────────
export async function getOrderDetail(q: Q, orderId: string) {
  const o = (
    await q.query(
      `select o.*, s.name_en as store_name_en, s.name_ar as store_name_ar, s.eta_min_minutes, s.eta_max_minutes
     from orders o join stores s on s.id = o.store_id where o.id = $1`,
      [orderId],
    )
  ).rows[0];
  if (!o) return null;
  const items = await q.query(
    'select oi.*, p.image_url from order_items oi join products p on p.id = oi.product_id where oi.order_id = $1 order by oi.created_at, oi.id',
    [orderId],
  );
  const history = await q.query(
    'select from_status, to_status, note, created_at from order_status_history where order_id = $1 order by id',
    [orderId],
  );
  const subs = await q.query(
    `select sr.*, pp.name_en as proposed_name_en, pp.name_ar as proposed_name_ar, pp.brand as proposed_brand, pp.size_label as proposed_size, pp.price_minor as proposed_unit_price,
            oi.name_en as orig_name_en, oi.name_ar as orig_name_ar, oi.brand as orig_brand, oi.size_label as orig_size, oi.qty as orig_qty, oi.unit_price_minor as orig_unit_price
     from substitution_requests sr join order_items oi on oi.id = sr.order_item_id left join products pp on pp.id = sr.proposed_product_id
     where sr.order_id = $1 order by sr.created_at`,
    [orderId],
  );
  const payments = await q.query(
    'select provider, mode, status, amount_minor from payments where order_id = $1 order by created_at',
    [orderId],
  );
  const disputes = await q.query(
    'select id, status, reason, resolution, refund_minor, created_at from disputes where order_id = $1 order by created_at',
    [orderId],
  );
  const refunds = await q.query(
    'select amount_minor, reason, created_at from refunds where order_id = $1 order by created_at',
    [orderId],
  );
  return {
    order: o,
    items: items.rows,
    history: history.rows,
    substitutions: subs.rows,
    payments: payments.rows,
    refunds: refunds.rows,
    disputes: disputes.rows,
  };
}
