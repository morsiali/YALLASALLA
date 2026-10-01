import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './helpers.js';

let h: Harness;
let marina: string, barsha: string;
let newTok: string, bizId: string, storeId: string;
const product = (over: object = {}) => ({
  storeId,
  categoryCode: 'rice',
  sku: 'N-1',
  nameEn: 'House Rice',
  nameAr: 'أرز المحل',
  brand: 'NewCo',
  sizeLabel: '1 kg',
  priceMinor: 700,
  stockQty: 30,
  tier: 'value',
  dietary: ['halal', 'vegetarian'],
  allergens: [],
  ...over,
});

beforeAll(async () => {
  h = await startHarness();
  const areas = (await h.call(null, 'GET', '/areas')).body as any[];
  marina = areas.find((a) => a.name_en === 'Dubai Marina').id;
  barsha = areas.find((a) => a.name_en === 'Al Barsha').id;
});
afterAll(async () => {
  await h.close();
});

describe('merchant onboarding, verification and packages', () => {
  it('a new business account onboards, selects a package and waits for verification (not public yet)', async () => {
    newTok = await h.login('0505550001', { accountType: 'merchant', name: 'Noor' });
    expect((await h.call(newTok, 'GET', '/merchant/me')).body.businesses).toEqual([]);
    expect((await h.call(h.tokens.customer, 'GET', '/merchant/me')).status).toBe(403);
    const bad = await h.call(newTok, 'POST', '/merchant/onboard', { nameEn: 'N', nameAr: 'ن' });
    expect(bad.status).toBe(400);
    const r = await h.call(newTok, 'POST', '/merchant/onboard', {
      nameEn: 'Noor Fresh Trading',
      nameAr: 'نور فريش للتجارة',
      tradeLicenseNo: 'DED-TEST-77',
      contactPhone: '+97145550000',
      packageCode: 'starter',
      store: {
        nameEn: 'Noor Fresh',
        nameAr: 'نور فريش',
        areaIds: [marina],
        deliveryFeeMinor: 800,
        freeDeliveryOverMinor: 20000,
        minOrderMinor: 3000,
      },
    });
    expect(r.status).toBe(201);
    bizId = r.body.businessId;
    storeId = r.body.storeId;
    const dup = await h.call(newTok, 'POST', '/merchant/onboard', {
      nameEn: 'Second Co',
      nameAr: 'شركة ثانية',
      tradeLicenseNo: 'DED-TEST-78',
      contactPhone: '+97145550001',
      packageCode: 'starter',
      store: { nameEn: 'Second', nameAr: 'ثاني', areaIds: [marina] },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('BUSINESS_EXISTS');
    const stores = (await h.call(null, 'GET', `/stores?areaId=${marina}`)).body as any[];
    expect(stores.map((s) => s.name_en)).not.toContain('Noor Fresh');
    const me = (await h.call(newTok, 'GET', '/merchant/me')).body.businesses[0];
    expect(me).toMatchObject({ status: 'pending', member_role: 'owner' });
    expect(me.package.code).toBe('starter');
  });
  it('can prepare the catalog while pending, but the store stays invisible; the merchant cannot self-approve', async () => {
    expect((await h.call(newTok, 'POST', '/merchant/products', product())).status).toBe(201);
    expect((await h.call(null, 'GET', `/stores/${storeId}/products`)).body.items).toEqual([]);
    expect(
      (await h.call(newTok, 'POST', `/admin/businesses/${bizId}/review`, { decision: 'approve' })).status,
    ).toBe(403);
  });
  it('administrator reviews: reject/suspend need a reason, approval is audited and notifies the owner', async () => {
    expect(
      (await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, { decision: 'reject' })).body
        .error.code,
    ).toBe('REASON_REQUIRED');
    const rej = await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, {
      decision: 'reject',
      note: 'Trade licence photo is unreadable',
    });
    expect(rej.body.status).toBe('rejected');
    expect((await h.call(newTok, 'GET', '/merchant/me')).body.businesses[0].review_note).toMatch(
      /unreadable/,
    );
    expect((await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-2' }))).status).toBe(403); // rejected => read-only
    await h.owner(`update businesses set status = 'pending' where id = $1`, [bizId]);
    expect(
      (await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, { decision: 'approve' }))
        .body.status,
    ).toBe('approved');
    expect(
      (await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, { decision: 'approve' }))
        .status,
    ).toBe(409);
    expect((await h.call(null, 'GET', `/stores?areaId=${marina}`)).body.map((s: any) => s.name_en)).toContain(
      'Noor Fresh',
    );
    const audit = await h.svc(`select action, reason from audit_logs where entity_id = $1 order by id`, [
      bizId,
    ]);
    expect(audit.map((a) => a.action)).toEqual(['business.reject', 'business.approve']);
    expect(
      (await h.call(newTok, 'GET', '/notifications')).body.items.some(
        (n: any) => n.kind === 'business_review',
      ),
    ).toBe(true);
  });
  it('suspension hides the store immediately and blocks new orders', async () => {
    await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, {
      decision: 'suspend',
      note: 'Customer safety complaint under review',
    });
    expect(
      (await h.call(null, 'GET', `/stores?areaId=${marina}`)).body.map((s: any) => s.name_en),
    ).not.toContain('Noor Fresh');
    const o = await h.call(
      h.tokens.customer,
      'POST',
      '/orders',
      {
        storeId,
        items: [
          {
            productId: (await h.svc('select id from products where store_id = $1', [storeId]))[0].id,
            qty: 5,
          },
        ],
        address: { areaId: marina, building: 'x' },
        paymentMethod: 'cod',
        acceptTerms: true,
      },
      { 'idempotency-key': 'suspended-order-1' },
    );
    expect(o.body.error.code).toBe('STORE_UNAVAILABLE');
    expect((await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-3' }))).status).toBe(403);
    await h.call(h.tokens.admin, 'POST', `/admin/businesses/${bizId}/review`, { decision: 'reinstate' });
  });
});

describe('catalog, entitlements and package limits (data-driven)', () => {
  it('validates offers: only real discounts are allowed; stock/price edits keep offers honest', async () => {
    const bad = await h.call(
      newTok,
      'POST',
      '/merchant/products',
      product({ sku: 'N-4', compareAtMinor: 600 }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_OFFER');
    const ok = await h.call(
      newTok,
      'POST',
      '/merchant/products',
      product({ sku: 'N-5', priceMinor: 500, compareAtMinor: 800 }),
    );
    expect(ok.status).toBe(201);
    const up = await h.call(newTok, 'PATCH', `/merchant/products/${ok.body.id}/stock`, { priceMinor: 900 });
    expect(up.body.compare_at_minor).toBeNull();
    expect((await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-5' }))).status).toBe(409); // duplicate SKU
  });
  it('enforces max_products from the package row (change the row, behaviour changes — no code change)', async () => {
    const used = (await h.call(newTok, 'GET', '/merchant/products')).body.usage.products;
    await h.call(
      h.tokens.admin,
      'PUT',
      `/admin/packages/${(await h.svc(`select id from packages where code = 'starter'`))[0].id}`,
      {
        code: 'starter',
        nameEn: 'Starter',
        nameAr: 'الأساسية',
        priceMinor: 9900,
        billingInterval: 'month',
        trialDays: 14,
        active: true,
        entitlements: {
          max_products: used,
          max_ready_baskets: 2,
          staff_seats: 1,
          messages_per_day: 200,
          analytics: 'basic',
          max_stores: 1,
        },
      },
    );
    const r = await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-6' }));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PACKAGE_LIMIT_REACHED');
    expect(r.body.error.message).toMatch(/Upgrade/);
    expect(
      (await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-7', active: false }))).status,
    ).toBe(201); // inactive items do not count
  });
  it('downgrades are blocked with an exact explanation; upgrades take effect immediately', async () => {
    const growthTok = h.tokens.merchantOwner;
    const down = await h.call(growthTok, 'POST', '/merchant/package', { packageCode: 'starter' });
    expect(down.status).toBe(422);
    expect(down.body.error.code).toBe('DOWNGRADE_BLOCKED');
    expect(down.body.error.details.over.map((o: any) => o.what)).toEqual(
      expect.arrayContaining(['active products']),
    );
    const up = await h.call(newTok, 'POST', '/merchant/package', { packageCode: 'growth' });
    expect(up.status).toBe(200);
    expect((await h.call(newTok, 'POST', '/merchant/products', product({ sku: 'N-8' }))).status).toBe(201);
  });
  it('merchant tenants cannot map alternatives or read catalogs across businesses', async () => {
    const mine = await h.svc('select id from products where store_id = $1 limit 2', [storeId]);
    const foreign = (await h.svc('select id from products where store_id = $1 limit 1', [h.ids.store1]))[0];
    expect(
      (
        await h.call(newTok, 'POST', `/merchant/products/${mine[0].id}/alternatives`, {
          alternativeIds: [mine[1].id],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.call(newTok, 'POST', `/merchant/products/${mine[0].id}/alternatives`, {
          alternativeIds: [foreign.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.call(newTok, 'POST', `/merchant/products/${foreign.id}/alternatives`, { alternativeIds: [] }))
        .status,
    ).toBe(404);
    expect(
      (await h.call(newTok, 'PATCH', `/merchant/products/${foreign.id}/stock`, { stockQty: 0 })).status,
    ).toBe(404);
    const list = (await h.call(h.tokens.merchant2Owner, 'GET', '/merchant/products?limit=100')).body.items;
    expect(list.every((p: any) => p.store_id === h.ids.store2)).toBe(true);
  });
  it('ready baskets are limited by package and managed per store', async () => {
    const items = (
      await h.svc('select id from products where store_id = $1 and active limit 3', [storeId])
    ).map((p) => ({ productId: p.id, qty: 2 }));
    const body = (code: string) => ({
      storeId,
      code,
      basketType: 'single',
      nameEn: 'My Basket',
      nameAr: 'سلتي',
      householdSize: 1,
      durationDays: 7,
      items,
    });
    for (let i = 0; i < 8; i++)
      expect(
        (await h.call(newTok, 'POST', '/merchant/ready-baskets', body(`rb-${i}`))).status,
        `rb-${i}`,
      ).toBe(201);
    const over = await h.call(newTok, 'POST', '/merchant/ready-baskets', body('rb-9'));
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('PACKAGE_LIMIT_REACHED');
    const customerView = (await h.call(null, 'GET', `/ready-baskets?areaId=${marina}`)).body as any[];
    expect(customerView.filter((x) => x.store_name_en === 'Noor Fresh').length).toBe(8);
  });
});

describe('staff with scoped permissions', () => {
  it('staff with orders+conversations permissions cannot touch the catalog, staff list or package', async () => {
    const t = h.tokens.merchantStaff;
    expect((await h.call(t, 'GET', '/merchant/orders')).status).toBe(200);
    expect((await h.call(t, 'GET', '/merchant/products')).status).toBe(403);
    expect((await h.call(t, 'GET', '/merchant/reports')).status).toBe(403);
    expect((await h.call(t, 'GET', '/merchant/staff')).status).toBe(403);
    const p = (await h.svc('select id from products where store_id = $1 limit 1', [h.ids.store1]))[0];
    expect((await h.call(t, 'PATCH', `/merchant/products/${p.id}/stock`, { stockQty: 0 })).status).toBe(403);
  });
  it('the owner adds staff within the seat limit and permissions are enforced per request', async () => {
    const staffTok = await h.login('0505550002', { accountType: 'merchant', name: 'Omar Staff' });
    const add = await h.call(newTok, 'POST', '/merchant/staff', {
      phone: '0505550002',
      permissions: ['catalog'],
    });
    expect(add.status).toBe(201);
    expect((await h.call(staffTok, 'GET', '/merchant/products')).status).toBe(200);
    expect((await h.call(staffTok, 'GET', '/merchant/orders')).status).toBe(200); // RLS: no orders permission => empty list, not an error
    expect((await h.call(staffTok, 'GET', '/merchant/orders')).body).toEqual([]);
    const second = await h.login('0505550003', { accountType: 'merchant' });
    expect(second).toBeTruthy();
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{staff_seats}', '1') where code = 'growth'`,
    );
    const over = await h.call(newTok, 'POST', '/merchant/staff', {
      phone: '0505550003',
      permissions: ['orders'],
    });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('PACKAGE_LIMIT_REACHED');
    const customerAsStaff = await h.call(newTok, 'POST', '/merchant/staff', {
      phone: '0500000001',
      permissions: ['orders'],
    });
    expect([403, 422]).toContain(customerAsStaff.status);
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{staff_seats}', '5') where code = 'growth'`,
    );
  });
});

describe('reports and export', () => {
  it('basic vs advanced analytics follow the package; export is scoped to the business', async () => {
    const adv = (await h.call(h.tokens.merchantOwner, 'GET', '/merchant/reports')).body;
    expect(adv.analytics).toBe('advanced');
    expect(adv.topProducts).toBeDefined();
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{analytics}', '"basic"') where code = 'growth'`,
    );
    const basic = (await h.call(h.tokens.merchantOwner, 'GET', '/merchant/reports')).body;
    expect(basic.topProducts).toBeUndefined();
    expect(basic.delivered_orders).toBeGreaterThanOrEqual(1);
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{analytics}', '"advanced"') where code = 'growth'`,
    );
    const exp = (await h.call(h.tokens.merchantOwner, 'GET', '/merchant/export')).body;
    expect(exp.products.every((p: any) => p.store_id === h.ids.store1)).toBe(true);
    expect(exp.orders.length).toBeGreaterThan(0);
    const other = (await h.call(h.tokens.merchant2Owner, 'GET', '/merchant/export')).body;
    expect(other.orders).toEqual([]);
  });
  it('store profile edits are owner-only and update service areas used by discovery', async () => {
    const body = {
      nameEn: 'Barsha Family Grocers',
      nameAr: 'بقالة البرشاء العائلية',
      deliveryFeeMinor: 1200,
      freeDeliveryOverMinor: 30000,
      minOrderMinor: 8000,
      etaMinMinutes: 60,
      etaMaxMinutes: 120,
      acceptsCod: true,
      active: true,
      openingHours: { open: '07:00', close: '23:30' },
      areaIds: [barsha, marina],
    };
    expect(
      (await h.call(h.tokens.merchant2Owner, 'PUT', `/merchant/store/${h.ids.store2}`, body)).status,
    ).toBe(200);
    expect(
      ((await h.call(null, 'GET', `/stores?areaId=${marina}`)).body as any[]).map((s) => s.name_en),
    ).toContain('Barsha Family Grocers');
    expect(
      (await h.call(h.tokens.merchantOwner, 'PUT', `/merchant/store/${h.ids.store2}`, body)).status,
    ).toBe(404);
    expect(
      (
        await h.call(h.tokens.merchantStaff, 'PUT', `/merchant/store/${h.ids.store1}`, {
          ...body,
          areaIds: [marina],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call(h.tokens.merchant2Owner, 'PUT', `/merchant/store/${h.ids.store2}`, {
          ...body,
          etaMaxMinutes: 5,
        })
      ).status,
    ).toBe(400);
  });
});
