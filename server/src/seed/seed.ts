import pg from 'pg';
import { loadConfig } from '../config.js';
import { buildBasket } from '../domain/basketEngine.js';
import { defaultConstraints, type BasketType, type Constraints } from '../domain/types.js';
import { ALG, CATEGORIES, OUT_OF_STOCK, PRODUCTS, RULES, S2_OMIT, TAGS } from './catalog.js';
import { loadProducts, loadRules, loadStore } from '../services/loaders.js';

export const SEED = {
  phones: {
    customer: '+971500000001', customer2: '+971500000002', merchantOwner: '+971500000011', merchantStaff: '+971500000012',
    merchant2Owner: '+971500000013', merchantPending: '+971500000014', admin: '+971500000099', support: '+971500000098',
  },
  otp: '123456',   // accepted only when OTP_PROVIDER=mock (local development)
};

const hashFactor = (s: string) => {
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.94 + (h % 13) / 100;           // 0.94 .. 1.06 deterministic per sku
};

export async function seed(databaseUrl?: string): Promise<Record<string, string>> {
  const cfg = loadConfig();
  const client = new pg.Client({ connectionString: databaseUrl ?? cfg.serviceDatabaseUrl });
  await client.connect();
  const ids: Record<string, string> = {};
  const one = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0];
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id','',true)");
    // ── users
    const mkUser = async (key: string, phone: string, name: string, role: string, locale = 'en') => {
      ids[key] = (await one('insert into users(phone,name,role,locale) values ($1,$2,$3,$4) returning id', [phone, name, role, locale])).id;
    };
    await mkUser('customer', SEED.phones.customer, 'Layla Al Mansoori', 'customer', 'ar');
    await mkUser('customer2', SEED.phones.customer2, 'Omar Khan', 'customer', 'en');
    await mkUser('merchantOwner', SEED.phones.merchantOwner, 'Hassan Idris', 'merchant');
    await mkUser('merchantStaff', SEED.phones.merchantStaff, 'Sara Nasser', 'merchant');
    await mkUser('merchant2Owner', SEED.phones.merchant2Owner, 'Fatima Rahman', 'merchant');
    await mkUser('merchantPending', SEED.phones.merchantPending, 'Yousef Haddad', 'merchant');
    await mkUser('admin', SEED.phones.admin, 'Platform Admin', 'admin');
    await mkUser('support', SEED.phones.support, 'Support Agent', 'support');

    // ── reference data
    for (const [code, group, en, ar, order] of CATEGORIES) {
      ids[`cat:${code}`] = (await one('insert into categories(code,need_group,name_en,name_ar,sort_order) values ($1,$2,$3,$4,$5) returning id', [code, group, en, ar, order])).id;
    }
    for (const [code, rate, prio, min, max, flag, boost] of RULES) {
      await client.query(
        'insert into basket_rules(category_id,units_per_person_week,priority,min_units,max_units,requires_flag,high_protein_boost) values ($1,$2,$3,$4,$5,$6,$7)',
        [ids[`cat:${code}`], rate, prio, min, max, flag, boost]);
    }
    const areas: [string, string, string, string, number, number][] = [
      ['Dubai', 'Dubai Marina', 'دبي مارينا', 'marina', 25.0805, 55.1403], ['Dubai', 'Jumeirah Lakes Towers (JLT)', 'أبراج بحيرات جميرا', 'jlt', 25.0689, 55.1445],
      ['Dubai', 'Al Barsha', 'البرشاء', 'barsha', 25.1124, 55.2004], ['Dubai', 'Downtown Dubai', 'وسط مدينة دبي', 'downtown', 25.1972, 55.2744],
      ['Dubai', 'Business Bay', 'الخليج التجاري', 'bbay', 25.1851, 55.2623], ['Sharjah', 'Al Majaz', 'المجاز', 'majaz', 25.3239, 55.3827],
      ['Ajman', 'Al Nuaimia', 'النعيمية', 'nuaimia', 25.4052, 55.4474], ['Abu Dhabi', 'Khalidiyah', 'الخالدية', 'khalidiyah', 24.4667, 54.3500],
    ];
    for (const [em, en, ar, key, lat, lng] of areas) {
      ids[`area:${key}`] = (await one('insert into areas(emirate,name_en,name_ar,lat,lng) values ($1,$2,$3,$4,$5) returning id', [em, en, ar, lat, lng])).id;
    }
    await client.query('insert into loyalty_rules(id) values (1)');

    // ── packages (data-driven entitlements)
    const pk = async (code: string, en: string, ar: string, price: number, trial: number, ent: object) => {
      ids[`pkg:${code}`] = (await one('insert into packages(code,name_en,name_ar,price_minor,billing_interval,trial_days,entitlements) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [code, en, ar, price, 'month', trial, JSON.stringify(ent)])).id;
    };
    await pk('starter', 'Starter', 'الأساسية', 9900, 14, { max_products: 60, max_ready_baskets: 2, staff_seats: 1, messages_per_day: 200, analytics: 'basic', max_stores: 1 });
    await pk('growth', 'Growth', 'النمو', 29900, 14, { max_products: 500, max_ready_baskets: 8, staff_seats: 5, messages_per_day: 2000, analytics: 'advanced', max_stores: 3 });

    // ── businesses & stores
    const mkBiz = async (key: string, owner: string, en: string, ar: string, status: string, pkg: string | null, lic: string) => {
      ids[key] = (await one('insert into businesses(owner_id,name_en,name_ar,trade_license_no,contact_phone,status,package_id,reviewed_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
        [ids[owner], en, ar, lic, '+97142000000', status, pkg ? ids[`pkg:${pkg}`] : null, status === 'approved' ? new Date() : null])).id;
      await client.query("insert into business_members(business_id,user_id,member_role) values ($1,$2,'owner')", [ids[key], ids[owner]]);
      if (pkg) await client.query("insert into subscriptions(business_id,package_id,status,trial_ends_at) values ($1,$2,'trial', now() + interval '14 days')", [ids[key], ids[`pkg:${pkg}`]]);
    };
    await mkBiz('biz1', 'merchantOwner', 'Marina Fresh Trading LLC', 'مارينا فريش للتجارة ذ.م.م', 'approved', 'growth', 'DED-DEMO-1001');
    await mkBiz('biz2', 'merchant2Owner', 'Barsha Family Grocers LLC', 'بقالة البرشاء العائلية ذ.م.م', 'approved', 'growth', 'DED-DEMO-1002');
    await mkBiz('biz3', 'merchantPending', 'Gulf Green Basket Trading', 'الخليج جرين باسكت للتجارة', 'pending', 'starter', 'DED-DEMO-1003');
    await client.query("insert into business_members(business_id,user_id,member_role,permissions) values ($1,$2,'staff','{orders,conversations}')", [ids.biz1, ids.merchantStaff]);

    const mkStore = async (key: string, biz: string, en: string, ar: string, dEn: string, dAr: string, fee: number, free: number, min: number, eta: [number, number], areaKeys: string[]) => {
      ids[key] = (await one(
        'insert into stores(business_id,name_en,name_ar,description_en,description_ar,phone,cover_image,delivery_fee_minor,free_delivery_over_minor,min_order_minor,eta_min_minutes,eta_max_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id',
        [ids[biz], en, ar, dEn, dAr, '+97142000000', '/img/store-cover.svg', fee, free, min, eta[0], eta[1]])).id;
      for (const a of areaKeys) await client.query('insert into store_areas(store_id,area_id) values ($1,$2)', [ids[key], ids[`area:${a}`]]);
    };
    await mkStore('store1', 'biz1', 'Marina Fresh Market', 'سوق مارينا الطازج', 'Neighbourhood grocery for Dubai Marina and JLT with fresh produce, dairy and household essentials.',
      'بقالة حي لدبي مارينا وأبراج بحيرات جميرا: خضار وفواكه طازجة وألبان ومستلزمات المنزل.', 1000, 25000, 6000, [45, 90], ['marina', 'jlt']);
    await mkStore('store2', 'biz2', 'Barsha Family Grocers', 'بقالة البرشاء العائلية', 'Family-run grocer serving Al Barsha and JLT with wide pantry choice.',
      'بقالة عائلية تخدم البرشاء وأبراج بحيرات جميرا مع تشكيلة واسعة للمؤن.', 1200, 30000, 8000, [60, 120], ['barsha', 'jlt']);

    // ── products
    for (const [skey, factorBase] of [['store1', 1], ['store2', 0.98]] as const) {
      for (const [cat, sku, en, ar, brand, size, price, tier, tags, alg, origin] of PRODUCTS) {
        if (skey === 'store2' && S2_OMIT.has(sku)) continue;
        const p = skey === 'store1' ? price : Math.max(100, Math.round((price * factorBase * hashFactor(sku)) / 10) * 10);
        const oos = OUT_OF_STOCK.has(`${skey === 'store2' ? 'S2' : 'S1'}:${sku}`);
        // a few genuine offers (compare-at is the store's previous shelf price)
        const offer = sku === 'RICE-S' && skey === 'store1' ? 1250 : sku === 'EGG-V' && skey === 'store2' ? 950 : null;
        const pid = (await one(
          `insert into products(store_id,category_id,sku,name_en,name_ar,brand,size_label,price_minor,compare_at_minor,stock_qty,image_url,tier,dietary,allergens,country_of_origin,description_en)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
          [ids[skey], ids[`cat:${cat}`], sku, en, ar, brand, size, p, offer, oos ? 0 : 40, `/img/cat/${cat}.svg`, tier,
            tags ? tags.split(',').map((t) => TAGS[t]) : [], alg ? alg.split(',').map((a) => ALG[a]) : [], origin, `${en} — ${size}`])).id;
        ids[`${skey}:${sku}`] = pid;
      }
    }
    // merchant-mapped alternatives: same-category products in the same store, cheaper/dearer neighbours
    await client.query(
      `insert into product_alternatives(product_id, alternative_id)
       select a.id, b.id from products a join products b on a.store_id = b.store_id and a.category_id = b.category_id and a.id <> b.id`);

    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    await client.end();
    throw e;
  }

  // ── derived data: ready baskets built with the same engine customers use
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id','',true)");
    const rules = await loadRules(client as any);
    const templates: { code: string; type: BasketType; en: string; ar: string; dEn: string; dAr: string; hh: number; days: number; patch: Partial<Constraints> }[] = [
      { code: 'family-weekly', type: 'family_weekly', en: 'Family Weekly Basket', ar: 'سلة الأسرة الأسبوعية', dEn: 'Weekly staples for a family of 4.', dAr: 'أساسيات أسبوعية لأسرة من 4 أفراد.', hh: 4, days: 7, patch: { tier: 'any' } },
      { code: 'budget', type: 'budget', en: 'Budget Basket', ar: 'سلة على ميزانيتك', dEn: 'Value-tier essentials for 4 people, a week.', dAr: 'أساسيات اقتصادية لأربعة أفراد لمدة أسبوع.', hh: 4, days: 7, patch: { tier: 'value', includeOptional: false } },
      { code: 'single', type: 'single', en: 'Single Professional Basket', ar: 'سلة الفرد الواحد', dEn: 'One person, one week.', dAr: 'فرد واحد لمدة أسبوع.', hh: 1, days: 7, patch: {} },
      { code: 'monthly', type: 'monthly', en: 'Monthly Essentials Basket', ar: 'سلة أساسيات الشهر', dEn: 'Month-long essentials for 4 people.', dAr: 'أساسيات شهرية لأربعة أفراد.', hh: 4, days: 30, patch: { includeOptional: false } },
      { code: 'baby', type: 'baby', en: 'Baby Essentials Basket', ar: 'سلة الطفل', dEn: 'Baby care plus family basics for 3 people, a week.', dAr: 'مستلزمات الطفل مع أساسيات الأسرة لثلاثة أفراد لمدة أسبوع.', hh: 3, days: 7, patch: { baby: true } },
      { code: 'healthy', type: 'healthy', en: 'Healthy Week Basket', ar: 'سلة أسبوع صحي', dEn: 'Lower-sugar, high-protein picks for 2 people.', dAr: 'خيارات قليلة السكر وغنية بالبروتين لشخصين.', hh: 2, days: 7, patch: { diet: ['high_protein', 'low_sugar'], includeOptional: false } },
    ];
    for (const sk of ['store1', 'store2']) {
      const store = (await loadStore(client as any, ids[sk]))!;
      const products = await loadProducts(client as any, [ids[sk]]);
      for (const t of templates) {
        const c: Constraints = { ...defaultConstraints(), household: t.hh, days: t.days, basketType: t.type, ...t.patch };
        const res = buildBasket({ constraints: c, store, products, rules });
        const rb = await one(
          'insert into ready_baskets(store_id,code,basket_type,name_en,name_ar,description_en,description_ar,household_size,duration_days) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
          [ids[sk], t.code, t.type, t.en, t.ar, t.dEn, t.dAr, t.hh, t.days]);
        for (const l of res.lines) await client.query('insert into ready_basket_items(ready_basket_id,product_id,qty) values ($1,$2,$3)', [rb.id, l.productId, l.qty]);
      }
    }

    // ── a delivered past order for Layla (repeat-basket demo). Prices were slightly lower back then.
    const items: [string, number][] = [['RICE-S', 2], ['MLK-V', 6], ['EGG-V', 2], ['CHK-V', 2], ['TOM-S', 2], ['WTR-V', 3], ['BAN-S', 2]];
    const prods = await client.query('select id, sku, name_en, name_ar, brand, size_label, price_minor from products where store_id = $1', [ids.store1]);
    const bySku = new Map(prods.rows.map((r) => [r.sku, r]));
    const lines = items.map(([sku, qty]) => ({ p: bySku.get(sku), qty, unit: Math.max(100, bySku.get(sku).price_minor - 30) }));
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const o = await one(
      `insert into orders(customer_id,store_id,business_id,status,subtotal_minor,delivery_fee_minor,total_minor,budget_minor,budget_includes_delivery,budget_status,
         substitution_policy,address,payment_method,payment_status,idempotency_key,placed_at)
       values ($1,$2,$3,'delivered',$4,1000,$5,15000,true,'within','ask',$6,'cod','paid','seed-order-1', now() - interval '10 days') returning id`,
      [ids.customer, ids.store1, ids.biz1, subtotal, subtotal + 1000,
        JSON.stringify({ contactName: 'Layla Al Mansoori', contactPhone: SEED.phones.customer, areaId: ids['area:marina'], building: 'Marina Tower 3', unit: '1204', instructions: 'Call on arrival' })]);
    ids.seedOrder = o.id;
    for (const l of lines) {
      await client.query('insert into order_items(order_id,product_id,name_en,name_ar,brand,size_label,qty,unit_price_minor,line_total_minor) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [o.id, l.p.id, l.p.name_en, l.p.name_ar, l.p.brand, l.p.size_label, l.qty, l.unit, l.unit * l.qty]);
    }
    await client.query("insert into loyalty_ledger(user_id,order_id,kind,points,available_at,reason,idempotency_key) values ($1,$2,'earn',$3,now() - interval '5 days','Eligible delivered order',$4)",
      [ids.customer, o.id, Math.floor(subtotal / 100), `seed-earn-${o.id}`]);
    await client.query("insert into addresses(user_id,area_id,label,building,unit,instructions) values ($1,$2,'Home','Marina Tower 3','1204','Call on arrival')", [ids.customer, ids['area:marina']]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
  return ids;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then((ids) => console.log(`seeded: ${Object.keys(ids).length} reference ids. Local login OTP: ${SEED.otp}`), (e) => { console.error(e); process.exit(1); });
}
