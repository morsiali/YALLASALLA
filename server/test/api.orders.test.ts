import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signWebhook } from '../src/providers/index.js';
import { idem, startHarness, type Harness } from './helpers.js';

let h: Harness;
let marina: string;
const sku = async (store: string, s: string) => (await h.svc('select id, price_minor from products where store_id = $1 and sku = $2', [store, s]))[0];

async function items(store: string, spec: [string, number][]) {
  const out = [];
  for (const [s, qty] of spec) out.push({ productId: (await sku(store, s)).id, qty });
  return out;
}
const basicItems = () => items(h.ids.store1, [['RICE-S', 2], ['MLK-V', 6], ['CHK-V', 2], ['TOM-S', 3], ['BAN-S', 2], ['WTR-V', 4]]);   // ≈ AED 150
async function order(token: string, over: any = {}, key = idem()) {
  const body = {
    storeId: h.ids.store1, items: await basicItems(), constraints: { budgetMinor: 30000, budgetIncludesDelivery: true, substitutionPolicy: 'ask' },
    address: { areaId: marina, building: 'Marina Tower 3', unit: '1204' }, paymentMethod: 'cod', acceptTerms: true, ...over,
  };
  return { key, res: await h.call(token, 'POST', '/orders', body, { 'idempotency-key': key }) };
}
const move = (token: string, id: string, to: string) => h.call(token, 'POST', `/merchant/orders/${id}/status`, { to });

beforeAll(async () => {
  h = await startHarness();
  marina = ((await h.call(null, 'GET', '/areas')).body as any[]).find((a) => a.name_en === 'Dubai Marina').id;
});
afterAll(async () => { await h.close(); });
// plenty of stock so tests do not starve each other; stock-sensitive tests set their own values
beforeEach(async () => { await h.svc("update products set stock_qty = 500 where not (store_id = $1 and sku = 'TUN-V')", [h.ids.store2]); });

describe('checkout', () => {
  it('requires authentication, terms and an idempotency key', async () => {
    expect((await order(null as any)).res.status).toBe(401);
    expect((await order(h.tokens.customer, { acceptTerms: false })).res.status).toBe(400);
    const r = await h.call(h.tokens.customer, 'POST', '/orders', { storeId: h.ids.store1, items: await basicItems(), address: { areaId: marina, building: 'x' }, paymentMethod: 'cod', acceptTerms: true });
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('creates the order with server-computed totals and decrements stock', async () => {
    const before = (await sku(h.ids.store1, 'MLK-V')).id;
    const stock0 = (await h.svc('select stock_qty from products where id = $1', [before]))[0].stock_qty;
    const { res } = await order(h.tokens.customer);
    expect(res.status).toBe(201);
    const o = res.body.order;
    expect(o.status).toBe('received'); expect(o.payment_status).toBe('cod_due');
    expect(o.total_minor).toBe(o.subtotal_minor + o.delivery_fee_minor - o.loyalty_redeemed_minor);
    const expected = res.body.items.reduce((s: number, i: any) => s + i.line_total_minor, 0);
    expect(o.subtotal_minor).toBe(expected);
    expect((await h.svc('select stock_qty from products where id = $1', [before]))[0].stock_qty).toBe(stock0 - 6);
    expect(res.body.history.map((x: any) => x.to_status)).toEqual(['received']);
  });
  it('is idempotent: the same key never creates a second order', async () => {
    const key = idem();
    const a = await order(h.tokens.customer, {}, key); const b = await order(h.tokens.customer, {}, key);
    expect(a.res.status).toBe(201); expect(b.res.status).toBe(200); expect(b.res.body.idempotentReplay).toBe(true);
    expect(b.res.body.order.id).toBe(a.res.body.order.id);
    const n = await h.svc('select count(*)::int n from orders where idempotency_key = $1', [key]);
    expect(n[0].n).toBe(1);
  });
  it('concurrent duplicate submissions still produce a single order', async () => {
    const key = idem();
    const rs = await Promise.all([1, 2, 3].map(() => order(h.tokens.customer, {}, key)));
    expect(new Set(rs.map((r) => r.res.body.order?.id)).size).toBe(1);
    expect((await h.svc('select count(*)::int n from orders where idempotency_key = $1', [key]))[0].n).toBe(1);
  });
  it('blocks an order above the budget unless the customer explicitly approves it', async () => {
    const tight = { budgetMinor: 10000, budgetIncludesDelivery: true, substitutionPolicy: 'ask' };
    const blocked = await order(h.tokens.customer, { constraints: tight });
    expect(blocked.res.status).toBe(409); expect(blocked.res.body.error.code).toBe('BUDGET_EXCEEDED');
    expect(blocked.res.body.error.details.overByMinor).toBeGreaterThan(0);
    const ok = await order(h.tokens.customer, { constraints: tight, approveOverBudget: true });
    expect(ok.res.status).toBe(201); expect(ok.res.body.order.budget_status).toBe('over_approved');
  });
  it('delivery counts toward a total budget: items alone fit, items + delivery do not', async () => {
    const probe = (await order(h.tokens.customer, { constraints: { budgetMinor: 5000000 } })).res.body.order;
    const exact = probe.subtotal_minor;   // budget == product value, delivery pushes it over
    const total = await order(h.tokens.customer, { constraints: { budgetMinor: exact, budgetIncludesDelivery: true } });
    expect(probe.delivery_fee_minor).toBeGreaterThan(0); expect(total.res.body.error.code).toBe('BUDGET_EXCEEDED');
    const productsOnly = await order(h.tokens.customer, { constraints: { budgetMinor: exact, budgetIncludesDelivery: false } });
    expect(productsOnly.res.status).toBe(201); expect(productsOnly.res.body.order.total_minor).toBe(exact + probe.delivery_fee_minor);
  });
  it('rejects unsupported delivery areas with alternatives, below-minimum baskets, and sold-out quantities', async () => {
    const downtown = ((await h.call(null, 'GET', '/areas')).body as any[]).find((a) => a.name_en === 'Downtown Dubai').id;
    const u = await order(h.tokens.customer, { address: { areaId: downtown, building: 'x' } });
    expect(u.res.body.error.code).toBe('UNSUPPORTED_AREA');
    const small = await order(h.tokens.customer, { items: await items(h.ids.store1, [['SUG-S', 1]]) });
    expect(small.res.body.error.code).toBe('BELOW_MIN_ORDER');
    await h.svc(`update products set stock_qty = 5 where store_id = $1 and sku = 'RICE-S'`, [h.ids.store1]);
    const huge = await order(h.tokens.customer, { items: await items(h.ids.store1, [['RICE-S', 99]]) });
    expect(huge.res.status).toBe(409); expect(huge.res.body.error.code).toBe('ITEMS_UNAVAILABLE'); expect(huge.res.body.error.details.items[0].requested).toBe(99);
  });
  it('ignores client-claimed prices entirely', async () => {
    const body: any = { storeId: h.ids.store1, items: (await basicItems()).map((i) => ({ ...i, unitPriceMinor: 1 })), address: { areaId: marina, building: 'x' }, paymentMethod: 'cod', acceptTerms: true, totalMinor: 1 };
    const r = await h.call(h.tokens.customer, 'POST', '/orders', body, { 'idempotency-key': idem() });
    expect(r.status).toBe(201); expect(r.body.order.total_minor).toBeGreaterThan(10000);
  });
  it('merchants cannot place orders; restricted accounts cannot transact', async () => {
    expect((await order(h.tokens.merchantOwner)).res.status).toBe(403);
    await h.svc(`update users set status = 'restricted' where id = $1`, [h.ids.customer2]);
    const r = await order(h.tokens.customer2);
    expect(r.res.status).toBe(403); expect(r.res.body.error.code).toBe('ACCOUNT_RESTRICTED');
    await h.svc(`update users set status = 'active' where id = $1`, [h.ids.customer2]);
  });
});

describe('fulfilment and tracking (merchant + customer)', () => {
  it('walks the whole timeline, validated server-side, with tenant isolation', async () => {
    const { res } = await order(h.tokens.customer); const id = res.body.order.id;
    expect((await h.call(h.tokens.merchant2Owner, 'GET', `/merchant/orders/${id}`)).status).toBe(404);          // other tenant
    expect((await h.call(h.tokens.customer2, 'GET', `/orders/${id}`)).status).toBe(404);                         // other customer
    expect((await move(h.tokens.merchant2Owner, id, 'reviewing')).status).toBe(404);
    expect((await move(h.tokens.merchantOwner, id, 'delivered')).status).toBe(409);                              // cannot skip steps
    for (const to of ['reviewing', 'preparing', 'ready', 'out_for_delivery', 'delivered']) expect((await move(h.tokens.merchantStaff, id, to)).status, to).toBe(200);
    const d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.history.map((x: any) => x.to_status)).toEqual(['received', 'reviewing', 'preparing', 'ready', 'out_for_delivery', 'delivered']);
    expect(d.order.payment_status).toBe('paid');
    const notes = (await h.call(h.tokens.customer, 'GET', '/notifications')).body;
    expect(notes.items.map((n: any) => n.kind)).toEqual(expect.arrayContaining(['order_received', 'order_delivered']));
    const mo = (await h.call(h.tokens.merchantOwner, 'GET', '/merchant/orders')).body;
    expect(mo.find((o: any) => o.id === id)).toBeTruthy();
    expect(((await h.call(h.tokens.merchant2Owner, 'GET', '/merchant/orders')).body as any[]).find((o) => o.id === id)).toBeUndefined();
  });
  it('customers can cancel only before preparation; cancellation restores stock and redeemed points', async () => {
    const id0 = (await sku(h.ids.store1, 'MLK-V')).id;
    const stock = (await h.svc('select stock_qty from products where id = $1', [id0]))[0].stock_qty;
    const { res } = await order(h.tokens.customer); const id = res.body.order.id;
    expect((await h.svc('select stock_qty from products where id = $1', [id0]))[0].stock_qty).toBe(stock - 6);
    expect((await h.call(h.tokens.customer, 'POST', `/orders/${id}/cancel`, {})).status).toBe(200);
    expect((await h.svc('select stock_qty from products where id = $1', [id0]))[0].stock_qty).toBe(stock);
    const { res: r2 } = await order(h.tokens.customer);
    await move(h.tokens.merchantOwner, r2.body.order.id, 'reviewing'); await move(h.tokens.merchantOwner, r2.body.order.id, 'preparing');
    const late = await h.call(h.tokens.customer, 'POST', `/orders/${r2.body.order.id}/cancel`, {});
    expect(late.status).toBe(409); expect(late.body.error.code).toBe('INVALID_TRANSITION');
  });
  it('a merchant rejecting an order releases everything and tells the customer', async () => {
    const { res } = await order(h.tokens.customer);
    expect((await move(h.tokens.merchantOwner, res.body.order.id, 'rejected')).status).toBe(200);
    const d = (await h.call(h.tokens.customer, 'GET', `/orders/${res.body.order.id}`)).body;
    expect(d.order.status).toBe('rejected');
    expect(((await h.call(h.tokens.customer, 'GET', '/notifications')).body.items as any[]).some((n) => n.kind === 'order_rejected')).toBe(true);
  });
});

describe('substitutions', () => {
  async function placed(policy: 'ask' | 'auto' | 'none', paymentToken?: string) {
    const body: any = { constraints: { budgetMinor: 90000, budgetIncludesDelivery: true, substitutionPolicy: policy } };
    if (paymentToken) { body.paymentMethod = 'sandbox_card'; body.paymentToken = paymentToken; }
    const { res } = await order(h.tokens.customer, body);
    const id = res.body.order.id;
    await move(h.tokens.merchantOwner, id, 'reviewing');
    return { id, items: res.body.items as any[] };
  }
  const unavailable = (id: string, itemId: string, proposedProductId: string | null) => h.call(h.tokens.merchantOwner, 'POST', `/merchant/orders/${id}/items/${itemId}/unavailable`, { proposedProductId, reason: 'sold out' });

  it('"ask": never substitutes silently; customer approves from the order and it is mirrored in the conversation', async () => {
    const { id, items: its } = await placed('ask');
    const rice = its.find((i) => i.name_en === 'Basmati Rice');
    const alt = await sku(h.ids.store1, 'RICE-P');
    const r = await unavailable(id, rice.id, alt.id);
    expect(r.body.outcome).toBe('pending');
    let d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.items.find((i: any) => i.id === rice.id).status).toBe('unavailable');
    expect(d.items.filter((i: any) => i.name_en.includes('Premium')).length).toBe(0);               // nothing replaced yet
    const sub = d.substitutions[0];
    expect(sub.status).toBe('pending'); expect(sub.price_diff_minor).toBe((alt.price_minor - rice.unit_price_minor) * rice.qty);
    expect(sub.differences.map((x: any) => x.field)).toEqual(expect.arrayContaining(['brand']));
    expect((await move(h.tokens.merchantOwner, id, 'preparing')).body.error.code).toBe('SUBSTITUTIONS_PENDING');
    const conv = await h.svc(`select m.kind from messages m join conversations c on c.id = m.conversation_id where c.customer_id = $1 and m.ref_id = $2`, [h.ids.customer, id]);
    expect(conv.map((x) => x.kind)).toContain('substitution');
    const before = d.order.total_minor;
    expect((await h.call(h.tokens.customer2, 'POST', `/orders/${id}/substitutions/${sub.id}`, { decision: 'accept' })).status).toBe(404);
    expect((await h.call(h.tokens.customer, 'POST', `/orders/${id}/substitutions/${sub.id}`, { decision: 'accept' })).status).toBe(200);
    d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.order.total_minor).toBe(before + sub.price_diff_minor);
    expect(d.items.find((i: any) => i.name_en.includes('Premium')).status).toBe('ok');
    expect((await h.call(h.tokens.customer, 'POST', `/orders/${id}/substitutions/${sub.id}`, { decision: 'accept' })).status).toBe(409);   // already answered
    expect((await move(h.tokens.merchantOwner, id, 'preparing')).status).toBe(200);
  });
  it('"ask": rejecting a proposal removes the item and lowers the total', async () => {
    const { id, items: its } = await placed('ask');
    const tom = its.find((i) => i.name_en === 'Tomatoes');
    await unavailable(id, tom.id, null);                                                              // no suitable substitute exists
    let d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.substitutions[0].proposed_product_id).toBeNull();
    const before = d.order.total_minor;
    await h.call(h.tokens.customer, 'POST', `/orders/${id}/substitutions/${d.substitutions[0].id}`, { decision: 'accept' });   // accept = continue without it
    d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.order.total_minor).toBe(before - tom.line_total_minor); expect(d.items.find((i: any) => i.id === tom.id).status).toBe('removed');
  });
  it('"auto": applies only within limits, otherwise falls back to asking', async () => {
    const { id, items: its } = await placed('auto');
    const rice = its.find((i) => i.name_en === 'Basmati Rice');
    const cheaper = await sku(h.ids.store1, 'RICE-V');
    const ok = await unavailable(id, rice.id, cheaper.id);
    expect(ok.body.outcome).toBe('auto_applied');
    const milk = its.find((i) => i.name_en === 'Full Fat Fresh Milk');
    const organic = await sku(h.ids.store1, 'MLK-O');           // +AED 4 x 6 = 24 on a 39 line => above 15% => must ask
    const asks = await unavailable(id, milk.id, organic.id);
    expect(asks.body.outcome).toBe('pending');
  });
  it('"auto" never substitutes into the customer\'s allergens even when the price is lower; it asks instead', async () => {
    const lf = await sku(h.ids.store1, 'MLK-L');            // lactose-free (no dairy allergen)
    const { res } = await order(h.tokens.customer, {
      items: [...(await items(h.ids.store1, [['RICE-S', 2], ['CHK-V', 2], ['TOM-S', 3], ['BAN-S', 2], ['WTR-V', 4]])), { productId: lf.id, qty: 4 }],
      constraints: { budgetMinor: 90000, budgetIncludesDelivery: true, substitutionPolicy: 'auto', allergens: ['dairy'] },
    });
    const id = res.body.order.id;
    await move(h.tokens.merchantOwner, id, 'reviewing');
    const milk = res.body.items.find((i: any) => i.name_en === 'Lactose-free Milk');
    const r = await unavailable(id, milk.id, (await sku(h.ids.store1, 'MLK-V')).id);   // contains dairy and is CHEAPER
    expect(r.body.outcome).toBe('pending');
    const wrongCat = await unavailable(id, res.body.items.find((i: any) => i.name_en === 'Bananas').id, (await sku(h.ids.store1, 'TOM-S')).id);
    expect(wrongCat.body.error.code).toBe('INVALID_SUBSTITUTE');
  });
  it('"none": the item is removed, totals fall, and the delivery fee never rises', async () => {
    const { id, items: its } = await placed('none');
    const before = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body.order;
    const water = its.find((i) => i.name_en === 'Drinking Water');
    const r = await unavailable(id, water.id, (await sku(h.ids.store1, 'WTR-S')).id);
    expect(r.body.outcome).toBe('removed');
    const after = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body.order;
    expect(after.subtotal_minor).toBe(before.subtotal_minor - water.line_total_minor);
    expect(after.delivery_fee_minor).toBeLessThanOrEqual(before.delivery_fee_minor);
    expect(after.total_minor).toBe(after.subtotal_minor + after.delivery_fee_minor - after.loyalty_redeemed_minor);
  });
  it('prepaid orders: a pricier substitute is refused; cheaper ones refund the difference', async () => {
    const { id, items: its } = await placed('ask', 'tok_success');
    const rice = its.find((i) => i.name_en === 'Basmati Rice');
    expect((await unavailable(id, rice.id, (await sku(h.ids.store1, 'RICE-P')).id)).body.error.code).toBe('SUBSTITUTE_TOO_EXPENSIVE_FOR_PREPAID');
    const cheap = await unavailable(id, rice.id, (await sku(h.ids.store1, 'RICE-V')).id);
    expect(cheap.status).toBe(200);
    const d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    await h.call(h.tokens.customer, 'POST', `/orders/${id}/substitutions/${d.substitutions[0].id}`, { decision: 'accept' });
    const after = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(after.refunds[0].amount_minor).toBe(d.order.total_minor - after.order.total_minor);
  });
  it('a merchant from another business cannot report items on this order', async () => {
    const { id, items: its } = await placed('ask');
    const r = await h.call(h.tokens.merchant2Owner, 'POST', `/merchant/orders/${id}/items/${its[0].id}/unavailable`, {});
    expect(r.status).toBe(404);
  });
});

describe('payments (sandbox) — failure, pending, duplicate callbacks, outage', () => {
  const card = (token: string, over: any = {}, key = idem()) => order(h.tokens.customer, { paymentMethod: 'sandbox_card', paymentToken: token, ...over }, key);
  it('success marks the order paid and visible to the merchant', async () => {
    const { res } = await card('tok_success');
    expect(res.status).toBe(201); expect(res.body.order.payment_status).toBe('paid'); expect(res.body.order.status).toBe('received');
    expect(res.body.payments[0]).toMatchObject({ mode: 'sandbox', status: 'succeeded' });
  });
  it('a declined card creates no order, keeps stock, and explains what to do', async () => {
    const stock = (await h.svc(`select stock_qty from products where sku = 'MLK-V' and store_id = $1`, [h.ids.store1]))[0].stock_qty;
    const key = idem(); const { res } = await card('tok_decline', {}, key);
    expect(res.status).toBe(402); expect(res.body.error.code).toBe('PAYMENT_FAILED');
    expect((await h.svc('select count(*)::int n from orders where idempotency_key = $1', [key]))[0].n).toBe(0);
    expect((await h.svc(`select stock_qty from products where sku = 'MLK-V' and store_id = $1`, [h.ids.store1]))[0].stock_qty).toBe(stock);
  });
  it('a provider outage returns 503, charges nothing, and the same key can be retried', async () => {
    const key = idem();
    const bad = await card('tok_network', {}, key);
    expect(bad.res.status).toBe(503); expect(bad.res.body.error.code).toBe('PAYMENT_UNAVAILABLE');
    const retry = await card('tok_success', {}, key);
    expect(retry.res.status).toBe(201);
  });
  it('delayed confirmation: stays pending (hidden from the merchant) until a signed webhook arrives; duplicates are ignored', async () => {
    const { res } = await card('tok_pending'); const id = res.body.order.id;
    expect(res.body.order.status).toBe('pending_payment');
    expect(((await h.call(h.tokens.merchantOwner, 'GET', '/merchant/orders')).body as any[]).find((o) => o.id === id)).toBeUndefined();
    const ref = res.body.payments[0] ? (await h.svc('select provider_ref from payments where order_id = $1', [id]))[0].provider_ref : '';
    const payload = JSON.stringify({ eventId: `evt_${id}`, ref, status: 'succeeded' });
    const bad = await h.app.inject({ method: 'POST', url: '/api/webhooks/payments', payload, headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' } });
    expect(bad.statusCode).toBe(401);
    const sig = signWebhook(h.ctx.cfg.webhookSecret, payload);
    const send = () => h.app.inject({ method: 'POST', url: '/api/webhooks/payments', payload, headers: { 'content-type': 'application/json', 'x-signature': sig } });
    const first = await send(); const dup = await send();
    expect(first.json().applied).toBe(true); expect(dup.statusCode).toBe(200); expect(dup.json().applied).toBe(false);
    const d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.order.status).toBe('received'); expect(d.order.payment_status).toBe('paid');
    expect(((await h.call(h.tokens.merchantOwner, 'GET', '/merchant/orders')).body as any[]).find((o) => o.id === id)).toBeTruthy();
    expect((await h.svc(`select count(*)::int n from order_status_history where order_id = $1 and to_status = 'received'`, [id]))[0].n).toBe(1);
  });
  it('a failed delayed payment cancels the order and restores stock', async () => {
    const stock = (await h.svc(`select stock_qty from products where sku = 'MLK-V' and store_id = $1`, [h.ids.store1]))[0].stock_qty;
    const { res } = await card('tok_pending'); const id = res.body.order.id;
    const ref = (await h.svc('select provider_ref from payments where order_id = $1', [id]))[0].provider_ref;
    const payload = JSON.stringify({ eventId: `evt_fail_${id}`, ref, status: 'failed' });
    await h.app.inject({ method: 'POST', url: '/api/webhooks/payments', payload, headers: { 'content-type': 'application/json', 'x-signature': signWebhook(h.ctx.cfg.webhookSecret, payload) } });
    expect((await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body.order.status).toBe('cancelled');
    expect((await h.svc(`select stock_qty from products where sku = 'MLK-V' and store_id = $1`, [h.ids.store1]))[0].stock_qty).toBe(stock);
  });
  it('card orders cancelled before preparation are refunded', async () => {
    const { res } = await card('tok_success'); const id = res.body.order.id;
    await h.call(h.tokens.customer, 'POST', `/orders/${id}/cancel`, {});
    const d = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    expect(d.order.payment_status).toBe('refunded'); expect(d.refunds[0].amount_minor).toBe(d.order.total_minor);
  });
});

describe('loyalty: pending, available, redemption, reversal, history', () => {
  const balance = async () => (await h.call(h.tokens.customer2, 'GET', '/loyalty')).body;
  async function deliver(token: string, over: any = {}) {
    const { res } = await order(token, over); const id = res.body.order.id;
    for (const to of ['reviewing', 'preparing', 'ready', 'out_for_delivery', 'delivered']) await move(h.tokens.merchantOwner, id, to);
    return id;
  }
  it('earns pending points on delivery (not on placement), excluding delivery fees; they become available after the hold', async () => {
    const placed = await order(h.tokens.customer2);
    expect((await balance()).pending).toBe(0);
    const id = placed.res.body.order.id;
    for (const to of ['reviewing', 'preparing', 'ready', 'out_for_delivery', 'delivered']) await move(h.tokens.merchantOwner, id, to);
    const b = await balance();
    const subtotal = placed.res.body.order.subtotal_minor;
    expect(b.pending).toBe(Math.floor(subtotal / 100)); expect(b.available).toBe(0);
    expect(b.ledger[0]).toMatchObject({ kind: 'earn', status: 'pending', order_no: placed.res.body.order.order_no });
    await h.svc(`update orders set updated_at = now() where id = $1`, [id]);
    await h.owner(`alter table loyalty_ledger disable trigger loyalty_ledger_append_only`);
    await h.owner(`update loyalty_ledger set available_at = now() - interval '1 minute' where user_id = $1`, [h.ids.customer2]);   // simulate the hold window passing (test only)
    await h.owner(`alter table loyalty_ledger enable trigger loyalty_ledger_append_only`);
    const after = await balance();
    expect(after.available).toBe(b.pending); expect(after.pending).toBe(0);
  });
  it('redemption obeys minimum, available-only, and the % cap; then earns exclude the redeemed part', async () => {
    const av = (await balance()).available;
    expect(av).toBeGreaterThan(100);
    await h.svc(`insert into loyalty_ledger(user_id,kind,points,reason,idempotency_key) values ($1,'adjust',2000,'test grant','t-grant-1')`, [h.ids.customer2]);
    const low = await order(h.tokens.customer2, { loyaltyPoints: 100 });
    expect(low.res.body.error.code).toBe('LOYALTY_INVALID');
    const tooMany = await order(h.tokens.customer2, { loyaltyPoints: 999999 });
    expect(tooMany.res.body.error.details.reason).toBe('insufficient');
    const over = await order(h.tokens.customer2, { loyaltyPoints: 2000 });       // > 20% cap of ~AED150 subtotal (AED 30 = 3000 pts) => allowed? 2000pts = AED 20
    expect(over.res.status).toBe(201); expect(over.res.body.order.loyalty_redeemed_minor).toBe(2000);
    expect(over.res.body.order.total_minor).toBe(over.res.body.order.subtotal_minor + over.res.body.order.delivery_fee_minor - 2000);
    const ledger = (await balance()).ledger.filter((l: any) => l.kind === 'redeem');
    expect(ledger[0].points).toBe(-2000);
    await h.svc(`insert into loyalty_ledger(user_id,kind,points,reason,idempotency_key) values ($1,'adjust',10000,'test grant','t-grant-cap')`, [h.ids.customer2]);
    const cap = await order(h.tokens.customer2, { loyaltyPoints: 6000 });             // AED 60 > 20% of the ~AED 150 basket
    expect(cap.res.status).toBe(422); expect(cap.res.body.error.details.reason).toBe('above_max');
  });
  it('cancelling an order that used points returns them (reversal entry, history preserved)', async () => {
    await h.svc(`insert into loyalty_ledger(user_id,kind,points,reason,idempotency_key) values ($1,'adjust',1000,'test grant','t-grant-2')`, [h.ids.customer2]);
    const before = (await balance()).available;
    const o = await order(h.tokens.customer2, { loyaltyPoints: 1000 });
    expect((await balance()).available).toBe(before - 1000);
    await h.call(h.tokens.customer2, 'POST', `/orders/${o.res.body.order.id}/cancel`, {});
    const b = await balance();
    expect(b.available).toBe(before);
    expect(b.ledger.map((l: any) => l.kind)).toEqual(expect.arrayContaining(['redeem', 'redeem_reversal']));
  });
  it('a refund through a resolved dispute reverses the earned points proportionally and is audited', async () => {
    const id = await deliver(h.tokens.customer);
    const d0 = (await h.call(h.tokens.customer, 'GET', `/orders/${id}`)).body;
    const earn = (await h.svc(`select points from loyalty_ledger where order_id = $1 and kind = 'earn'`, [id]))[0].points;
    expect(earn).toBeGreaterThan(0);
    const disp = await h.call(h.tokens.customer, 'POST', `/orders/${id}/dispute`, { reason: 'Milk was spoiled' });
    expect(disp.status).toBe(200);
    expect((await h.call(h.tokens.customer, 'POST', `/orders/${id}/dispute`, { reason: 'again' })).status).toBe(409);
    expect((await h.call(h.tokens.customer, 'POST', `/admin/disputes/${disp.body.id}/resolve`, { status: 'resolved', resolution: 'ok fine', refundMinor: 100 })).status).toBe(403);
    expect((await h.call(h.tokens.admin, 'POST', `/admin/disputes/${disp.body.id}/resolve`, { status: 'resolved', resolution: 'x', refundMinor: 100 })).status).toBe(400);   // reason too short
    const half = Math.floor(d0.order.total_minor / 2);
    expect((await h.call(h.tokens.admin, 'POST', `/admin/disputes/${disp.body.id}/resolve`, { status: 'resolved', resolution: 'Spoiled milk, partial refund approved', refundMinor: half })).status).toBe(200);
    const rev = await h.svc(`select points from loyalty_ledger where order_id = $1 and kind = 'earn_reversal'`, [id]);
    expect(rev[0].points).toBe(-Math.ceil(earn * (half / d0.order.total_minor)));
    expect((await h.call(h.tokens.admin, 'POST', `/admin/disputes/${disp.body.id}/resolve`, { status: 'resolved', resolution: 'again again', refundMinor: 1 })).status).toBe(409);
    const audit = await h.svc(`select action, reason from audit_logs where entity_id = $1`, [disp.body.id]);
    expect(audit[0]).toMatchObject({ action: 'dispute.resolve' });
    const tooMuch = await h.call(h.tokens.customer, 'POST', `/orders/${id}/dispute`, { reason: 'second dispute' });
    expect(tooMuch.status).toBe(200);
    const big = await h.call(h.tokens.support, 'POST', `/admin/disputes/${tooMuch.body.id}/resolve`, { status: 'resolved', resolution: 'refund too large', refundMinor: d0.order.total_minor });
    expect(big.body.error.code).toBe('REFUND_TOO_LARGE');
  });
  it('points expire when old and unspent (idempotent job)', async () => {
    await h.owner(`alter table loyalty_ledger disable trigger loyalty_ledger_append_only`);
    await h.svc(`insert into loyalty_ledger(user_id,kind,points,available_at,reason,idempotency_key) values ($1,'earn',700,now() - interval '400 days','old','t-old-1')`, [h.ids.merchantStaff]);
    await h.owner(`alter table loyalty_ledger enable trigger loyalty_ledger_append_only`);
    const r1 = (await h.call(h.tokens.admin, 'POST', '/admin/jobs/run')).body; const r2 = (await h.call(h.tokens.admin, 'POST', '/admin/jobs/run')).body;
    expect(r1.pointsExpired).toBeGreaterThanOrEqual(700); expect(r2.pointsExpired).toBe(0);
    expect((await h.svc(`select coalesce(sum(points),0)::int s from loyalty_ledger where user_id = $1`, [h.ids.merchantStaff]))[0].s).toBe(0);
  });
});

describe('repeat basket', () => {
  it('previews price changes and unavailable items before re-ordering and shows the difference from last time', async () => {
    await h.svc(`update products set price_minor = price_minor + 100 where store_id = $1 and sku = 'RICE-S'`, [h.ids.store1]);
    await h.svc(`update products set stock_qty = 0 where store_id = $1 and sku = 'EGG-V'`, [h.ids.store1]);
    const p = (await h.call(h.tokens.customer, 'GET', `/orders/${h.ids.seedOrder}/reorder-preview`)).body;
    const rice = p.lines.find((l: any) => l.name.en === 'Basmati Rice'); const eggs = p.lines.find((l: any) => l.name.en === 'White Eggs');
    expect(rice.status).toBe('price_changed'); expect(rice.newUnitPriceMinor).toBe(rice.oldUnitPriceMinor + 130);   // seed order was priced 30 fils lower; +100 since
    expect(eggs.status).toBe('unavailable'); expect(eggs.suggestion).toBeTruthy();
    expect(p.differenceMinor).toBe(p.totals.totalMinor - p.previousTotalMinor);
    expect((await h.call(h.tokens.customer2, 'GET', `/orders/${h.ids.seedOrder}/reorder-preview`)).status).toBe(404);
  });
});
