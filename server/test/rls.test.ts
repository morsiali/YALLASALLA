import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../src/seed/seed.js';
import { startHarness, type Harness } from './helpers.js';

let h: Harness;
let appPool: pg.Pool;
/** Query as yalasala_app with a given user identity — exactly what the API does, minus the API. */
async function asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<{ rows: any[]; error?: any }> {
  const c = await appPool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId ?? '']);
    try { const r = await c.query(sql, params); await c.query('commit'); return { rows: r.rows }; }
    catch (error) { await c.query('rollback'); return { rows: [], error }; }
  } finally { c.release(); }
}

beforeAll(async () => { h = await startHarness(); appPool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL }); });
afterAll(async () => { await appPool.end(); await h.close(); });

describe('database-level authorization (RLS), independent of the API', () => {
  it('anonymous users see public catalog but no private data', async () => {
    expect((await asUser(null, 'select count(*)::int n from products')).rows[0].n).toBeGreaterThan(50);
    for (const t of ['orders', 'users', 'conversations', 'loyalty_ledger', 'addresses', 'audit_logs', 'consents']) {
      expect((await asUser(null, `select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
    }
  });
  it('a customer only sees their own orders / ledger / addresses', async () => {
    const mine = await asUser(h.ids.customer, 'select customer_id from orders');
    expect(mine.rows.length).toBeGreaterThan(0); expect(new Set(mine.rows.map((r) => r.customer_id))).toEqual(new Set([h.ids.customer]));
    expect((await asUser(h.ids.customer2, 'select count(*)::int n from orders')).rows[0].n).toBe(0);
    expect((await asUser(h.ids.customer2, 'select count(*)::int n from loyalty_ledger')).rows[0].n).toBe(0);
    expect((await asUser(h.ids.customer2, 'select count(*)::int n from addresses')).rows[0].n).toBe(0);
  });
  it('merchant tenants are isolated: business 2 owner cannot see or edit business 1 data', async () => {
    expect((await asUser(h.ids.merchant2Owner, 'select count(*)::int n from orders')).rows[0].n).toBe(0);
    const upd = await asUser(h.ids.merchant2Owner, 'update products set price_minor = 1 where store_id = $1 returning id', [h.ids.store1]);
    expect(upd.rows).toHaveLength(0);
    const ins = await asUser(h.ids.merchant2Owner, `insert into products(store_id,category_id,sku,name_en,name_ar,brand,size_label,price_minor,stock_qty) values ($1,$2,'X','x','x','x','1',100,1)`, [h.ids.store1, h.ids['cat:rice']]);
    expect(ins.error?.code).toBe('42501');
  });
  it('the owner of business 1 sees its orders, staff only with the orders permission', async () => {
    expect((await asUser(h.ids.merchantOwner, 'select count(*)::int n from orders')).rows[0].n).toBeGreaterThan(0);
    expect((await asUser(h.ids.merchantStaff, 'select count(*)::int n from orders')).rows[0].n).toBeGreaterThan(0);
    // staff has no catalog permission => cannot write products
    const r = await asUser(h.ids.merchantStaff, 'update products set price_minor = price_minor where store_id = $1 returning id', [h.ids.store1]);
    expect(r.rows).toHaveLength(0);
  });
  it('clients cannot escalate privileges or touch protected columns', async () => {
    expect((await asUser(h.ids.customer, `update users set role = 'admin' where id = $1`, [h.ids.customer])).error?.code).toBe('42501');
    expect((await asUser(h.ids.customer, `update orders set status = 'delivered'`)).error?.code).toBe('42501');   // no UPDATE grant at all
    expect((await asUser(h.ids.customer, `insert into loyalty_ledger(user_id,kind,points,reason,idempotency_key) values ($1,'adjust',99999,'x','k')`, [h.ids.customer])).error?.code).toBe('42501');
    expect((await asUser(h.ids.merchantOwner, `update businesses set package_id = (select id from packages limit 1) where id = $1`, [h.ids.biz1])).error?.code).toBe('42501');
  });
  it('a merchant cannot approve their own business (trigger + policy)', async () => {
    const r = await asUser(h.ids.merchantPending, `update businesses set status = 'approved' where id = $1`, [h.ids.biz3]);
    expect(r.error?.code).toBe('42501');
  });
  it('conversations: non-parties cannot read or post; support can only read reported ones', async () => {
    const conv = (await h.svc(`insert into conversations(customer_id,customer_name,store_id,business_id) values ($1,'Layla',$2,$3) returning id`, [h.ids.customer, h.ids.store1, h.ids.biz1]))[0].id;
    await h.svc(`insert into messages(conversation_id,sender_id,sender_side,kind,body) values ($1,$2,'customer','text','hello')`, [conv, h.ids.customer]);
    expect((await asUser(h.ids.customer2, 'select count(*)::int n from messages')).rows[0].n).toBe(0);
    expect((await asUser(h.ids.merchant2Owner, 'select count(*)::int n from messages')).rows[0].n).toBe(0);
    expect((await asUser(h.ids.merchantOwner, 'select count(*)::int n from messages')).rows[0].n).toBe(1);
    expect((await asUser(h.ids.customer2, `insert into messages(conversation_id,sender_id,sender_side,kind,body) values ($1,$2,'customer','text','spoof')`, [conv, h.ids.customer2])).error?.code).toBe('42501');
    expect((await asUser(h.ids.support, 'select count(*)::int n from messages')).rows[0].n).toBe(0);
    await h.svc(`insert into reports(reporter_id,target_type,target_id,reason) values ($1,'conversation',$2,'abusive language')`, [h.ids.merchantOwner, conv]);
    expect((await asUser(h.ids.support, 'select count(*)::int n from messages')).rows[0].n).toBe(1);
  });
  it('append-only tables reject updates and deletes even for the service role', async () => {
    await expect(h.svc(`update loyalty_ledger set points = 1`)).rejects.toThrow(/append-only/);
    await h.svc(`insert into audit_logs(action,entity) values ('test','test')`);
    await expect(h.svc(`delete from audit_logs`)).rejects.toThrow(/append-only/);
    await expect(h.svc(`delete from order_status_history`)).rejects.toThrow(/append-only/);
  });
  it('order state machine is enforced by the database', async () => {
    await expect(h.svc(`update orders set status = 'received' where id = $1`, [h.ids.seedOrder])).rejects.toThrow(/invalid order transition/);
  });
  it('money invariants are constraints', async () => {
    await expect(h.svc(`update orders set total_minor = total_minor + 1 where id = $1`, [h.ids.seedOrder])).rejects.toThrow(/check/);
    await expect(h.svc(`update products set price_minor = -5 where store_id = $1`, [h.ids.store1])).rejects.toThrow(/check/);
  });
  it('phone numbers are UAE mobiles', () => { expect(SEED.phones.customer).toMatch(/^\+9715\d{8}$/); });
});
