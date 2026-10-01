import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FailingAi } from '../src/providers/index.js';
import { startHarness, type Harness } from './helpers.js';

let h: Harness;
let area: Record<string, string> = {};
const base = (over: object = {}) => ({ areaId: area.jlt, household: 4, days: 7, budgetMinor: 60000, budgetIncludesDelivery: true, ...over });

beforeAll(async () => {
  h = await startHarness({ providers: { ai: new FailingAi() } });
  const areas = (await h.call(null, 'GET', '/areas')).body as any[];
  for (const a of areas) area[a.name_en.includes('JLT') ? 'jlt' : a.name_en.includes('Marina') ? 'marina' : a.name_en.includes('Barsha') ? 'barsha' : a.name_en.includes('Downtown') ? 'downtown' : a.name_en] = a.id;
});
afterAll(async () => { await h.close(); });

describe('service areas', () => {
  it('lists pilot areas as served and the rest as not yet served', async () => {
    const areas = (await h.call(null, 'GET', '/areas')).body as any[];
    expect(areas.find((a) => a.id === area.marina).served).toBe(true);
    expect(areas.find((a) => a.id === area.downtown).served).toBe(false);
  });
  it('filters stores by area', async () => {
    const marina = (await h.call(null, 'GET', `/stores?areaId=${area.marina}`)).body as any[];
    expect(marina.map((s) => s.name_en)).toEqual(['Marina Fresh Market']);
    const jlt = (await h.call(null, 'GET', `/stores?areaId=${area.jlt}`)).body as any[];
    expect(jlt).toHaveLength(2);
    expect((await h.call(null, 'GET', `/stores?areaId=${area.downtown}`)).body).toHaveLength(0);
  });
  it('unsupported area explains itself and lists served areas', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base({ areaId: area.downtown }), budgetScopeConfirmed: true });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('UNSUPPORTED_AREA');
    expect(r.body.error.details.servedAreas.length).toBeGreaterThanOrEqual(3);
  });
  it('permission-based location maps coordinates to the nearest area (nothing stored)', async () => {
    const r = await h.call(null, 'POST', '/areas/nearest', { lat: 25.0805, lng: 55.1403 });
    expect(r.body.id).toBe(area.marina);
  });
});

describe('basket generation from real seeded products', () => {
  it('requires the budget scope to be chosen first', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base() });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('BUDGET_SCOPE_REQUIRED');
  });
  it('works for guests and only uses existing, in-stock products priced from the database', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base(), budgetScopeConfirmed: true });
    expect(r.status).toBe(200);
    const ids = r.body.lines.map((l: any) => l.productId);
    const db = await h.svc('select id, price_minor, stock_qty, store_id from products where id = any($1::uuid[])', [ids]);
    expect(db).toHaveLength(ids.length);
    for (const l of r.body.lines) {
      const p = db.find((x) => x.id === l.productId);
      expect(p.store_id).toBe(r.body.store.id); expect(l.unitPriceMinor).toBe(p.price_minor); expect(l.lineTotalMinor).toBe(p.price_minor * l.qty); expect(p.stock_qty).toBeGreaterThanOrEqual(l.qty);
    }
    const sum = r.body.lines.reduce((s: number, l: any) => s + l.lineTotalMinor, 0);
    expect(r.body.totals.subtotalMinor).toBe(sum);
    expect(r.body.totals.totalMinor).toBe(sum + r.body.totals.deliveryFeeMinor);
    expect(r.body.facts.map((f: any) => f.code)).toContain('planned_for');
    expect(r.body.generationId).toBeTruthy();
  });
  it('enforces a total budget INCLUDING delivery', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 45000 }), budgetScopeConfirmed: true });
    expect(r.body.budget.state).not.toBe('over');
    expect(r.body.totals.totalMinor).toBeLessThanOrEqual(45000);
    expect(r.body.totals.subtotalMinor + r.body.totals.deliveryFeeMinor).toBe(r.body.totals.totalMinor);
  });
  it('product-only budget leaves delivery outside the budget and says so', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 30000, budgetIncludesDelivery: false, areaId: area.barsha }), budgetScopeConfirmed: true });
    expect(r.body.budget.scope).toBe('products');
    expect(r.body.budget.spendMinor).toBe(r.body.totals.subtotalMinor);
  });
  it('a too-low budget gives an honest shortfall, keeps essentials and offers recovery options', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 8000 }), budgetScopeConfirmed: true });
    expect(r.body.budget.state).toBe('over'); expect(r.body.shortfallMinor).toBe(r.body.totals.totalMinor - 8000);
    expect(r.body.recovery).toEqual(expect.arrayContaining(['raise_budget', 'reduce_duration']));
    expect(r.body.lines.filter((l: any) => l.priority === 'essential').length).toBeGreaterThan(8);
  });
  it('dietary and allergen restrictions are never violated', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 90000, diet: ['vegetarian', 'gluten_free'], allergens: ['nuts', 'dairy'] }), budgetScopeConfirmed: true });
    for (const l of r.body.lines) {
      if (['cleaning', 'personal_care', 'baby_family'].includes(l.needGroup)) continue;
      expect(l.dietary, l.name.en).toEqual(expect.arrayContaining(['vegetarian', 'gluten_free']));
      expect(l.allergens, l.name.en).not.toEqual(expect.arrayContaining(['nuts'])); expect(l.allergens).not.toContain('dairy');
    }
    expect(r.body.lines.some((l: any) => l.categoryCode === 'chicken')).toBe(false);
  });
  it('can compare stores and picks a single store, saying so', async () => {
    const r = await h.call(null, 'POST', '/baskets/generate', { constraints: base(), budgetScopeConfirmed: true });
    expect(r.body.compared).toBe(2); expect(r.body.facts.map((f: any) => f.code)).toContain('store_chosen');
  });
});

describe('editing: replacement and immediate total recalculation', () => {
  it('replacing an item reprices subtotal, delivery, total and budget status server-side', async () => {
    const gen = (await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 70000, tier: 'value' }), budgetScopeConfirmed: true })).body;
    const line = gen.lines.find((l: any) => l.categoryCode === 'rice');
    const alts = (await h.call(null, 'GET', `/products/${line.productId}/alternatives?qty=${line.qty}`)).body;
    expect(alts.alternatives.length).toBeGreaterThan(0);
    const alt = alts.alternatives.find((a: any) => a.priceDiffMinor > 0)!;
    expect(['similar_price', 'higher_price']).toContain(alt.kind);
    const items = gen.lines.map((l: any) => ({ productId: l.productId === line.productId ? alt.productId : l.productId, qty: l.qty }));
    const priced = (await h.call(null, 'POST', '/baskets/price', { storeId: gen.store.id, items, constraints: base({ budgetMinor: 70000 }) })).body;
    expect(priced.totals.subtotalMinor - gen.totals.subtotalMinor).toBe(alt.priceDiffMinor);
    expect(priced.budget.remainingMinor).toBe(70000 - priced.totals.totalMinor);
  });
  it('flags removal of an essential product', async () => {
    const gen = (await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 90000 }), budgetScopeConfirmed: true })).body;
    const items = gen.lines.filter((l: any) => l.categoryCode !== 'rice').map((l: any) => ({ productId: l.productId, qty: l.qty }));
    const r = (await h.call(null, 'POST', '/baskets/price', { storeId: gen.store.id, items, constraints: base() })).body;
    expect(r.missingEssentials).toContain('rice');
  });
  it('shows status "over" when an edit pushes the total above the budget', async () => {
    const gen = (await h.call(null, 'POST', '/baskets/generate', { constraints: base({ budgetMinor: 90000 }), budgetScopeConfirmed: true })).body;
    const items = gen.lines.map((l: any) => ({ productId: l.productId, qty: l.qty * 5 }));
    const r = (await h.call(null, 'POST', '/baskets/price', { storeId: gen.store.id, items, constraints: base({ budgetMinor: 90000 }) })).body;
    expect(r.budget.state).toBe('over');
  });
  it('ignores products from another store (no cross-store price injection)', async () => {
    const other = await h.svc('select id from products where store_id = $1 limit 1', [h.ids.store2]);
    const r = (await h.call(null, 'POST', '/baskets/price', { storeId: h.ids.store1, items: [{ productId: other[0].id, qty: 1 }] })).body;
    expect(r.lines).toHaveLength(0); expect(r.dropped).toBe(1);
  });
});

describe('natural language + rules fallback when AI is unavailable', () => {
  it('parses text and reports that the AI provider failed and rules were used', async () => {
    const r = await h.call(null, 'POST', '/baskets/parse', { text: 'Family of 4 in Dubai Marina for a week, budget AED 500 including delivery, halal' });
    expect(r.status).toBe(200);
    expect(r.body.ai).toMatchObject({ provider: 'test-failing', used: false, fallbackUsed: true });
    expect(r.body.constraints).toMatchObject({ household: 4, days: 7, budgetMinor: 50000, budgetIncludesDelivery: true });
    const gen = await h.call(null, 'POST', '/baskets/generate', { constraints: { ...r.body.constraints, areaId: r.body.constraints.areaId }, budgetScopeConfirmed: true, fallbackUsed: true, source: 'natural' });
    expect(gen.status).toBe(200); expect(gen.body.lines.length).toBeGreaterThan(10);
    const row = await h.svc('select fallback_used from basket_generations where id = $1', [gen.body.generationId]);
    expect(row[0].fallback_used).toBe(true);
  });
  it('asks for confirmation of ambiguous fields', async () => {
    const r = await h.call(null, 'POST', '/baskets/parse', { text: 'I need milk and rice, 300 dirhams' });
    expect(r.body.needsConfirmation).toEqual(expect.arrayContaining(['budgetIncludesDelivery', 'areaId']));
  });
});

describe('ready baskets', () => {
  it('lists all six templates with household, duration, store and live price', async () => {
    const r = (await h.call(null, 'GET', `/ready-baskets?areaId=${area.marina}`)).body as any[];
    expect(r.map((x) => x.basket_type)).toEqual(['family_weekly', 'budget', 'single', 'monthly', 'baby', 'healthy']);
    for (const x of r) { expect(x.household_size).toBeGreaterThan(0); expect(x.duration_days).toBeGreaterThan(0); expect(x.store_name_en).toBe('Marina Fresh Market'); expect(x.items_total_minor).toBeGreaterThan(0); }
    const detail = (await h.call(null, 'GET', `/ready-baskets/${r[0].id}`)).body;
    expect(detail.totals.subtotalMinor).toBe(r[0].items_total_minor);
  });
  it('keyset pagination for store products', async () => {
    const p1 = (await h.call(null, 'GET', `/stores/${h.ids.store1}/products?limit=10`)).body;
    expect(p1.items).toHaveLength(10); expect(p1.nextCursor).toBeTruthy();
    const p2 = (await h.call(null, 'GET', `/stores/${h.ids.store1}/products?limit=10&cursor=${p1.nextCursor}`)).body;
    expect(p2.items[0].productId).not.toBe(p1.items[0].productId);
    expect(new Set([...p1.items, ...p2.items].map((i: any) => i.productId)).size).toBe(20);
  });
});
