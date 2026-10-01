import type { Q } from '../db.js';

export interface LoyaltyRules {
  earnPointsPerAed: number;
  holdDays: number;
  pointValueMinor: number;
  minRedeemPoints: number;
  maxRedeemPctOfSubtotal: number;
  expiryDays: number;
  dailyEarnCapPoints: number;
}
export async function getRules(q: Q): Promise<LoyaltyRules> {
  const { rows } = await q.query('select * from loyalty_rules where id = 1');
  const r = rows[0];
  return {
    earnPointsPerAed: Number(r.earn_points_per_aed),
    holdDays: r.hold_days,
    pointValueMinor: r.point_value_minor,
    minRedeemPoints: r.min_redeem_points,
    maxRedeemPctOfSubtotal: r.max_redeem_pct_of_subtotal,
    expiryDays: r.expiry_days,
    dailyEarnCapPoints: r.daily_earn_cap_points,
  };
}

/** available = entries whose available_at has passed; pending = entries still in their hold window. */
export async function getBalance(q: Q, userId: string) {
  const { rows } = await q.query(
    `select coalesce(sum(points) filter (where available_at <= now()), 0) as available,
            coalesce(sum(points) filter (where available_at > now()), 0) as pending
     from loyalty_ledger where user_id = $1`,
    [userId],
  );
  return { available: Number(rows[0].available), pending: Number(rows[0].pending) };
}

export async function earnForDeliveredOrder(
  q: Q,
  order: {
    id: string;
    customer_id: string;
    subtotal_minor: number;
    discount_minor: number;
    loyalty_redeemed_minor: number;
  },
) {
  const rules = await getRules(q);
  // exclusions: delivery fees and the part of the basket paid with points never earn points
  const eligible = Math.max(0, order.subtotal_minor - order.discount_minor - order.loyalty_redeemed_minor);
  let points = Math.floor((eligible / 100) * rules.earnPointsPerAed);
  const today = await q.query(
    `select coalesce(sum(points),0) as s from loyalty_ledger where user_id = $1 and kind = 'earn' and created_at > now() - interval '1 day'`,
    [order.customer_id],
  );
  points = Math.min(points, Math.max(0, rules.dailyEarnCapPoints - Number(today.rows[0].s)));
  if (points <= 0) return null;
  const r = await q.query(
    `insert into loyalty_ledger(user_id,order_id,kind,points,available_at,reason,idempotency_key)
     values ($1,$2,'earn',$3, now() + make_interval(days => $4), 'Eligible delivered order', $5)
     on conflict (idempotency_key) do nothing returning id`,
    [order.customer_id, order.id, points, rules.holdDays, `earn:${order.id}`],
  );
  return r.rows[0]?.id ?? null;
}

export async function redeem(q: Q, userId: string, orderId: string, points: number) {
  await q.query(
    `insert into loyalty_ledger(user_id,order_id,kind,points,reason,idempotency_key) values ($1,$2,'redeem',$3,'Redeemed at checkout',$4)
     on conflict (idempotency_key) do nothing`,
    [userId, orderId, -points, `redeem:${orderId}`],
  );
}
export async function reverseRedemption(q: Q, orderId: string, reason: string) {
  const { rows } = await q.query(
    `select id, user_id, points from loyalty_ledger where order_id = $1 and kind = 'redeem'`,
    [orderId],
  );
  for (const r of rows) {
    await q.query(
      `insert into loyalty_ledger(user_id,order_id,kind,points,reverses_id,reason,idempotency_key) values ($1,$2,'redeem_reversal',$3,$4,$5,$6)
       on conflict (idempotency_key) do nothing`,
      [r.user_id, orderId, -r.points, r.id, reason, `redeem_rev:${r.id}`],
    );
  }
}
/** Reverse (part of) an earn entry, e.g. after a refund. Proportional to refunded share of the order total. */
export async function reverseEarn(
  q: Q,
  orderId: string,
  share: number,
  reason: string,
  key: string,
  actorId: string | null,
) {
  const { rows } = await q.query(
    `select id, user_id, points, available_at from loyalty_ledger where order_id = $1 and kind = 'earn'`,
    [orderId],
  );
  for (const r of rows) {
    const pts = Math.min(r.points, Math.ceil(r.points * share));
    if (pts <= 0) continue;
    await q.query(
      `insert into loyalty_ledger(user_id,order_id,kind,points,available_at,reverses_id,reason,created_by,idempotency_key)
       values ($1,$2,'earn_reversal',$3,$4,$5,$6,$7,$8) on conflict (idempotency_key) do nothing`,
      [r.user_id, orderId, -pts, r.available_at, r.id, reason, actorId, `earn_rev:${r.id}:${key}`],
    );
  }
}

/** Expire old unspent points (FIFO: spending consumes the oldest earnings first). Idempotent per user per day. */
export async function expireDue(q: Q): Promise<number> {
  const rules = await getRules(q);
  const { rows } = await q.query(
    `select user_id,
       coalesce(sum(points) filter (where kind in ('earn','earn_reversal') and available_at < now() - make_interval(days => $1)), 0) as old_earned,
       coalesce(-sum(points) filter (where kind in ('redeem','redeem_reversal')), 0) as spent,
       coalesce(-sum(points) filter (where kind = 'expire'), 0) as expired,
       coalesce(sum(points) filter (where available_at <= now()), 0) as available
     from loyalty_ledger group by user_id`,
    [rules.expiryDays],
  );
  let total = 0;
  for (const r of rows) {
    const expirable = Math.min(
      Number(r.available),
      Math.max(0, Number(r.old_earned) - Number(r.spent) - Number(r.expired)),
    );
    if (expirable <= 0) continue;
    await q.query(
      `insert into loyalty_ledger(user_id,kind,points,reason,idempotency_key) values ($1,'expire',$2,'Points expired',$3) on conflict (idempotency_key) do nothing`,
      [r.user_id, -expirable, `expire:${r.user_id}:${new Date().toISOString().slice(0, 10)}`],
    );
    total += expirable;
  }
  return total;
}
