import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idem, startHarness, type Harness } from './helpers.js';

let h: Harness;
let marina: string;
beforeAll(async () => {
  h = await startHarness();
  marina = ((await h.call(null, 'GET', '/areas')).body as any[]).find((a) => a.name_en === 'Dubai Marina').id;
});
afterAll(async () => {
  await h.close();
});

describe('authentication (UAE phone + OTP test mode)', () => {
  it('normalises UAE numbers and rejects others', async () => {
    expect((await h.call(null, 'POST', '/auth/otp/request', { phone: '050 123 4567' })).body.phone).toBe(
      '+971501234567',
    );
    const bad = await h.call(null, 'POST', '/auth/otp/request', { phone: '+14155550123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PHONE');
  });
  it('wrong codes are counted and lock the code; test mode is declared', async () => {
    const req = await h.call(null, 'POST', '/auth/otp/request', { phone: '0509990001' });
    expect(req.body.mode).toBe('mock');
    expect(req.body.testModeNote).toMatch(/Test mode/);
    for (let i = 0; i < 5; i++)
      expect(
        (await h.call(null, 'POST', '/auth/otp/verify', { phone: '0509990001', code: '000000' })).body.error
          .code,
      ).toBe('OTP_INVALID');
    expect(
      (await h.call(null, 'POST', '/auth/otp/verify', { phone: '0509990001', code: '123456' })).body.error
        .code,
    ).toBe('OTP_LOCKED');
  });
  it('tokens are tamper-proof and /auth/me returns the caller only', async () => {
    expect((await h.call(null, 'GET', '/auth/me')).status).toBe(401);
    expect((await h.call(h.tokens.customer + 'x', 'GET', '/auth/me')).status).toBe(401);
    expect((await h.call(h.tokens.customer, 'GET', '/auth/me')).body.phone).toBe('+971500000001');
  });
  it('admin/support roles cannot be self-registered', async () => {
    const t = await h.login('0509990002', { accountType: 'customer', name: 'X' });
    expect((await h.call(t, 'GET', '/admin/kpis')).status).toBe(403);
    expect((await h.call(t, 'PATCH', '/me', { role: 'admin' })).status).toBe(200); // unknown field is ignored
    expect((await h.call(t, 'GET', '/auth/me')).body.role).toBe('customer');
  });
});

describe('administrator and support: roles, reasons, audit', () => {
  it('only staff roles reach admin endpoints; support has a narrower view', async () => {
    for (const path of [
      '/admin/kpis',
      '/admin/packages',
      '/admin/audit',
      '/admin/providers',
      '/admin/basket-rules',
    ]) {
      expect((await h.call(h.tokens.customer, 'GET', path)).status, path).toBe(403);
      expect((await h.call(h.tokens.merchantOwner, 'GET', path)).status, path).toBe(403);
      expect((await h.call(null, 'GET', path)).status, path).toBe(401);
    }
    expect((await h.call(h.tokens.support, 'GET', '/admin/orders')).status).toBe(200);
    expect((await h.call(h.tokens.support, 'GET', '/admin/disputes')).status).toBe(200);
    for (const path of ['/admin/kpis', '/admin/packages', '/admin/audit', '/admin/basket-rules'])
      expect((await h.call(h.tokens.support, 'GET', path)).status, path).toBe(403);
    expect(
      (
        await h.call(h.tokens.support, 'POST', '/admin/loyalty/adjust', {
          userId: h.ids.customer,
          points: 100,
          reason: 'nice try',
        })
      ).status,
    ).toBe(403);
  });
  it('loyalty adjustments need a reason, are idempotent, ledger-only (append) and audited', async () => {
    const body = {
      userId: h.ids.customer2,
      points: 500,
      reason: 'Goodwill after delayed delivery',
      key: 'adj-key-0001',
    };
    expect(
      (await h.call(h.tokens.admin, 'POST', '/admin/loyalty/adjust', { ...body, reason: 'x' })).status,
    ).toBe(400);
    const first = await h.call(h.tokens.admin, 'POST', '/admin/loyalty/adjust', body);
    expect(first.body.balance.available).toBe(500);
    const dup = await h.call(h.tokens.admin, 'POST', '/admin/loyalty/adjust', body);
    expect(dup.body.balance.available).toBe(500);
    expect(dup.body.entryId).toBeNull();
    const a = await h.svc(
      `select action, reason, detail from audit_logs where action = 'loyalty.adjust' and entity_id = $1`,
      [h.ids.customer2],
    );
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a[0].reason).toBe('Goodwill after delayed delivery');
    const entry = (await h.call(h.tokens.customer2, 'GET', '/loyalty')).body.ledger[0];
    expect(entry).toMatchObject({ kind: 'adjust', points: 500, reason: 'Goodwill after delayed delivery' });
  });
  it('basket rules are admin-configurable and change generation behaviour; every change is audited with a reason', async () => {
    const gen = () =>
      h.call(null, 'POST', '/baskets/generate', {
        constraints: { areaId: marina, household: 4, days: 7 },
        budgetScopeConfirmed: true,
      });
    const before = (await gen()).body.lines.find((l: any) => l.categoryCode === 'rice').qty;
    const rules = (await h.call(h.tokens.admin, 'GET', '/admin/basket-rules')).body as any[];
    const rice = rules.find((r) => r.code === 'rice');
    const upd = {
      unitsPerPersonWeek: 1,
      priority: 'essential',
      minUnits: 1,
      maxUnits: 20,
      highProteinBoost: 1,
      active: true,
    };
    expect(
      (await h.call(h.tokens.admin, 'PUT', `/admin/basket-rules/${rice.id}`, { ...upd, reason: '' })).status,
    ).toBe(400);
    expect(
      (
        await h.call(h.tokens.admin, 'PUT', `/admin/basket-rules/${rice.id}`, {
          ...upd,
          reason: 'Customers report running out of rice',
        })
      ).status,
    ).toBe(200);
    const after = (await gen()).body.lines.find((l: any) => l.categoryCode === 'rice').qty;
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(4);
    expect(
      (await h.svc(`select count(*)::int n from audit_logs where action = 'basket_rule.update'`))[0].n,
    ).toBe(1);
  });
  it('service areas, package prices and loyalty rules are configurable; changes appear in the audit log', async () => {
    const barsha = ((await h.call(null, 'GET', '/areas')).body as any[]).find(
      (a) => a.name_en === 'Al Barsha',
    ).id;
    expect(
      (
        await h.call(h.tokens.admin, 'PUT', `/admin/stores/${h.ids.store1}/areas`, {
          areaIds: [marina, barsha],
          reason: 'Expanding the pilot zone',
        })
      ).status,
    ).toBe(200);
    expect(
      ((await h.call(null, 'GET', `/stores?areaId=${barsha}`)).body as any[]).map((s) => s.name_en),
    ).toContain('Marina Fresh Market');
    const lr = {
      earnPointsPerAed: 2,
      holdDays: 1,
      pointValueMinor: 1,
      minRedeemPoints: 500,
      maxRedeemPctOfSubtotal: 20,
      expiryDays: 365,
      dailyEarnCapPoints: 5000,
    };
    expect(
      (await h.call(h.tokens.admin, 'PUT', '/admin/loyalty-rules', { ...lr, reason: 'ok' })).status,
    ).toBe(400);
    expect(
      (
        await h.call(h.tokens.admin, 'PUT', '/admin/loyalty-rules', {
          ...lr,
          reason: 'Double points trial for the pilot',
        })
      ).status,
    ).toBe(200);
    expect((await h.call(null, 'GET', '/config')).body.loyalty.earnPointsPerAed).toBe(2);
    expect(
      (
        await h.call(h.tokens.customer, 'PUT', '/admin/loyalty-rules', {
          ...lr,
          reason: 'I want more points',
        })
      ).status,
    ).toBe(403);
    const actions = (await h.call(h.tokens.admin, 'GET', '/admin/audit')).body.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['store.service_areas', 'loyalty_rules.update']));
    expect((await h.call(h.tokens.merchantOwner, 'GET', '/admin/audit')).status).toBe(403);
  });
  it('audit log cannot be edited through the API/DB roles; provider status never exposes secrets', async () => {
    await expect(h.svc(`update audit_logs set reason = 'tampered'`)).rejects.toThrow(/append-only/);
    const p = (await h.call(h.tokens.admin, 'GET', '/admin/providers')).body;
    expect(p.otp.mode).toBe('mock');
    expect(p.payments.mode).toBe('sandbox');
    expect(JSON.stringify(p)).not.toMatch(/change-me|sk-ant|owner_dev_pw|app_dev_pw/i);
    expect(Object.values(p.secretsConfigured).every((v) => typeof v === 'boolean')).toBe(true);
  });
  it('restricting a user is audited, requires a reason and blocks transacting but not data access', async () => {
    expect(
      (
        await h.call(h.tokens.admin, 'POST', `/admin/users/${h.ids.customer2}/status`, {
          status: 'restricted',
          reason: 'no',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call(h.tokens.admin, 'POST', `/admin/users/${h.ids.customer2}/status`, {
          status: 'restricted',
          reason: 'Repeated chargebacks under review',
        })
      ).status,
    ).toBe(200);
    const o = await h.call(
      h.tokens.customer2,
      'POST',
      '/orders',
      {
        storeId: h.ids.store1,
        items: [{ productId: (await h.svc('select id from products limit 1'))[0].id, qty: 1 }],
        address: { areaId: marina, building: 'x' },
        paymentMethod: 'cod',
        acceptTerms: true,
      },
      { 'idempotency-key': idem() },
    );
    expect(o.body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await h.call(h.tokens.customer2, 'GET', '/orders')).status).toBe(200);
    expect(
      (
        await h.call(h.tokens.admin, 'POST', `/admin/users/${h.ids.admin}/status`, {
          status: 'restricted',
          reason: 'attempt to lock admin',
        })
      ).status,
    ).toBe(403);
    await h.call(h.tokens.admin, 'POST', `/admin/users/${h.ids.customer2}/status`, {
      status: 'active',
      reason: 'Review completed, cleared',
    });
  });
  it('KPIs are available to administrators', async () => {
    const k = (await h.call(h.tokens.admin, 'GET', '/admin/kpis')).body;
    expect(k).toHaveProperty('basketsGenerated');
    expect(k).toHaveProperty('substitutionAcceptancePct');
    expect(k.note).toMatch(/courier/);
  });
});

describe('privacy: consent, export, deletion', () => {
  it('records consent history and exposes the latest state', async () => {
    await h.call(h.tokens.customer, 'PUT', '/me/consents', { kind: 'marketing', granted: true });
    await h.call(h.tokens.customer, 'PUT', '/me/consents', { kind: 'marketing', granted: false });
    const c = (await h.call(h.tokens.customer, 'GET', '/me/consents')).body as any[];
    expect(c.find((x) => x.kind === 'marketing').granted).toBe(false);
    expect(
      (
        await h.svc(`select count(*)::int n from consents where user_id = $1 and kind = 'marketing'`, [
          h.ids.customer,
        ])
      )[0].n,
    ).toBe(2);
  });
  it("exports exactly the caller's data (nobody else's)", async () => {
    const ex = await h.call(h.tokens.customer, 'POST', '/me/export', {});
    expect(ex.status).toBe(201);
    const d = ex.body.data;
    expect(d.profile.phone).toBe('+971500000001');
    expect(d.orders.length).toBeGreaterThanOrEqual(1);
    expect(d.orders.every((o: any) => o.customer_id === h.ids.customer)).toBe(true);
    expect(d.loyaltyLedger.every((l: any) => l.user_id === h.ids.customer)).toBe(true);
    expect(JSON.stringify(d)).not.toContain('+971500000002');
    const again = await h.call(h.tokens.customer, 'GET', `/me/export/${ex.body.id}`);
    expect(again.body.data.profile.id).toBe(h.ids.customer);
    expect((await h.call(h.tokens.customer2, 'GET', `/me/export/${ex.body.id}`)).status).toBe(404);
  });
  it('deletion is blocked while an order is open, then anonymises personal data but keeps financial records', async () => {
    const t = await h.login('0508880001', { name: 'Delete Me' });
    const items = (
      await h.svc(
        `select id from products where store_id = $1 and sku in ('RICE-S','MLK-V','CHK-V','WTR-V','BAN-S')`,
        [h.ids.store1],
      )
    ).map((p) => ({ productId: p.id, qty: 3 }));
    const placed = await h.call(
      t,
      'POST',
      '/orders',
      {
        storeId: h.ids.store1,
        items,
        address: { areaId: marina, building: 'Secret Tower', unit: '9' },
        paymentMethod: 'cod',
        acceptTerms: true,
      },
      { 'idempotency-key': idem() },
    );
    expect(placed.status).toBe(201);
    const blocked = await h.call(t, 'POST', '/me/delete', { confirm: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('OPEN_ORDERS');
    await h.call(t, 'POST', `/orders/${placed.body.order.id}/cancel`, {});
    expect((await h.call(t, 'POST', '/me/delete', {})).status).toBe(400); // explicit confirmation is required
    const done = await h.call(t, 'POST', '/me/delete', { confirm: 'DELETE' });
    expect(done.body.deleted).toBe(true);
    const u = (
      await h.svc(`select phone, name, status from users where phone <> all($1)`, [['+971500000001']])
    ).find((x) => x.status === 'deleted');
    expect(u.name).toBeNull();
    expect(u.phone).not.toBe('+971508880001');
    const order = (await h.svc('select address from orders where id = $1', [placed.body.order.id]))[0];
    expect(JSON.stringify(order.address)).not.toContain('Secret Tower');
    expect((await h.call(t, 'GET', '/auth/me')).status).toBe(401); // the token no longer works
  });
});

describe('operations: data export, backup and restore', () => {
  it('pg_dump + restore into a fresh database reproduces the data', async () => {
    const bin = ['/usr/lib/postgresql/16/bin', '/usr/bin'].find((d) => fs.existsSync(`${d}/pg_dump`));
    if (!bin) return; // CI image without pg client tools
    const url = new URL(process.env.DATABASE_URL!);
    const env = { ...process.env, PGPASSWORD: url.password };
    const conn = ['-h', url.hostname, '-p', url.port, '-U', url.username];
    const dump = '/tmp/yalasala-test-backup.sql';
    execFileSync(`${bin}/pg_dump`, [...conn, '-d', 'yalasala_test', '--no-owner', '-f', dump], { env });
    const admin = new pg.Client({
      connectionString: `postgres://${url.username}:${url.password}@${url.host}/postgres`,
    });
    await admin.connect();
    await admin.query('drop database if exists yalasala_restore');
    await admin.query('create database yalasala_restore');
    await admin.end();
    execFileSync(
      `${bin}/psql`,
      [...conn, '-d', 'yalasala_restore', '-v', 'ON_ERROR_STOP=1', '-q', '-f', dump],
      { env, stdio: 'pipe' },
    );
    const restored = new pg.Client({
      connectionString: `postgres://${url.username}:${url.password}@${url.host}/yalasala_restore`,
    });
    await restored.connect();
    for (const t of ['users', 'products', 'orders', 'order_items', 'loyalty_ledger', 'audit_logs']) {
      const a = (await h.svc(`select count(*)::int n from ${t}`))[0].n;
      const b = (await restored.query(`select count(*)::int n from ${t}`)).rows[0].n;
      expect(b, t).toBe(a);
    }
    expect(
      (await restored.query(`select count(*)::int n from pg_policies where schemaname = 'public'`)).rows[0].n,
    ).toBeGreaterThan(50); // RLS policies travel with the dump
    await restored.end();
    const admin2 = new pg.Client({
      connectionString: `postgres://${url.username}:${url.password}@${url.host}/postgres`,
    });
    await admin2.connect();
    await admin2.query('drop database yalasala_restore');
    await admin2.end();
    fs.rmSync(dump, { force: true });
  });
});
