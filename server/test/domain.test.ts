import { describe, expect, it } from 'vitest';
import { buildBasket, isEligible } from '../src/domain/basketEngine.js';
import { parseRequest } from '../src/domain/nlp.js';
import { budgetStatus, deliveryFee, priceLines } from '../src/domain/pricing.js';
import { defaultConstraints, type EngineProduct, type EngineRule, type EngineStore } from '../src/domain/types.js';

const store: EngineStore = { id: 's1', nameEn: 'S', nameAr: 'م', deliveryFeeMinor: 1500, freeDeliveryOverMinor: null, minOrderMinor: 0 };
const mk = (id: string, cat: string, price: number, extra: Partial<EngineProduct> = {}): EngineProduct => ({
  id, storeId: 's1', categoryCode: cat, needGroup: 'essentials', nameEn: id, nameAr: id, brand: 'B', sizeLabel: '1', priceMinor: price, compareAtMinor: null,
  stockQty: 50, tier: 'standard', dietary: ['halal', 'vegetarian'], allergens: [], imageUrl: null, substitutable: true, ...extra,
});
const rule = (cat: string, prio: EngineRule['priority'], rate = 1, extra: Partial<EngineRule> = {}): EngineRule => ({
  categoryCode: cat, needGroup: 'essentials', unitsPerPersonWeek: rate, priority: prio, minUnits: 1, maxUnits: 20, requiresFlag: null, highProteinBoost: 1, ...extra,
});
const areas = [{ id: 'marina', nameEn: 'Dubai Marina', nameAr: 'دبي مارينا' }, { id: 'jlt', nameEn: 'Jumeirah Lakes Towers (JLT)', nameAr: 'أبراج بحيرات جميرا' }];

describe('budget rules (spec examples)', () => {
  const lines = (sub: number) => priceLines([{ product: mk('p', 'x', sub), qty: 1 }], store).totals;
  it('total budget AED 500 incl. delivery: 475 + 15 = 490 leaves 10 and is not "over"', () => {
    const b = budgetStatus(lines(47500), 50000, true);
    expect(b.spendMinor).toBe(49000); expect(b.remainingMinor).toBe(1000); expect(b.state).toBe('close');
  });
  it('product-only budget AED 500: product 487 + delivery 15 = final 502, scope=products, delivery shown separately', () => {
    const t = lines(48700);
    expect(t.totalMinor).toBe(50200);
    const b = budgetStatus(t, 50000, false);
    expect(b.scope).toBe('products'); expect(b.spendMinor).toBe(48700); expect(b.state).not.toBe('over');
  });
  it('is "over" the moment delivery pushes a total budget past the limit', () => {
    expect(budgetStatus(lines(49000), 50000, true).state).toBe('over');
    expect(budgetStatus(lines(49000), 50000, true).overByMinor).toBe(500);
  });
  it('free delivery above the threshold changes the fee', () => {
    expect(deliveryFee({ ...store, freeDeliveryOverMinor: 20000 }, 19999)).toBe(1500);
    expect(deliveryFee({ ...store, freeDeliveryOverMinor: 20000 }, 20000)).toBe(0);
  });
  it('loyalty redemption reduces the total but not the subtotal', () => {
    const t = priceLines([{ product: mk('p', 'x', 10000), qty: 2 }], store, 500).totals;
    expect(t.subtotalMinor).toBe(20000); expect(t.totalMinor).toBe(20000 + 1500 - 500);
  });
});

describe('basket engine', () => {
  const rules = [rule('rice', 'essential', 0.5), rule('milk', 'essential', 2), rule('snacks', 'optional', 1), rule('pasta', 'standard', 0.5)];
  const products = [
    mk('rice-cheap', 'rice', 500, { tier: 'value' }), mk('rice-prem', 'rice', 1500, { tier: 'premium' }),
    mk('milk-1', 'milk', 600), mk('snack-1', 'snacks', 700, { needGroup: 'optional' }), mk('pasta-1', 'pasta', 400),
    mk('milk-nuts', 'milk', 100, { allergens: ['nuts'] }),
  ];
  const run = (over: Partial<ReturnType<typeof defaultConstraints>>) => buildBasket({ constraints: { ...defaultConstraints(), household: 4, days: 7, ...over }, store, products, rules });

  it('plans quantities from household size and duration', () => {
    const r = run({});
    expect(r.lines.find((l) => l.categoryCode === 'rice')!.qty).toBe(2);       // ceil(.5*4)
    expect(r.lines.find((l) => l.categoryCode === 'milk')!.qty).toBe(8);       // 2*4
    expect(run({ days: 14 }).lines.find((l) => l.categoryCode === 'milk')!.qty).toBe(16);
  });
  it('never exceeds a feasible total budget (delivery included) and recomputes fees', () => {
    const full = run({}).totals.totalMinor;
    const r = run({ budgetMinor: full - 1500, budgetIncludesDelivery: true });
    expect(r.totals.totalMinor).toBeLessThanOrEqual(full - 1500);
    expect(r.budget.state).not.toBe('over'); expect(r.shortfallMinor).toBe(0);
  });
  it('protects essentials and reports an honest shortfall when the budget is too low', () => {
    const r = run({ budgetMinor: 1000, budgetIncludesDelivery: true });
    expect(r.budget.state).toBe('over'); expect(r.shortfallMinor).toBeGreaterThan(0);
    expect(r.lines.some((l) => l.categoryCode === 'rice')).toBe(true);
    expect(r.lines.some((l) => l.categoryCode === 'milk')).toBe(true);
    expect(r.lines.some((l) => l.categoryCode === 'snacks')).toBe(false);          // optional dropped first
    expect(r.totals.totalMinor - 1000).toBe(r.shortfallMinor);
  });
  it('allergen and excluded-term constraints are hard filters', () => {
    const r = run({ allergens: ['nuts'] });
    expect(r.lines.find((l) => l.categoryCode === 'milk')!.productId).toBe('milk-1');
    expect(isEligible(products[5], { ...defaultConstraints(), allergens: ['nuts'] })).toBe(false);
    expect(run({ exclude: ['snack'] }).lines.some((l) => l.categoryCode === 'snacks')).toBe(false);
  });
  it('is deterministic', () => { expect(JSON.stringify(run({}))).toBe(JSON.stringify(run({}))); });
  it('value tier prefers cheaper, premium tier prefers premium', () => {
    expect(run({ tier: 'value' }).lines.find((l) => l.categoryCode === 'rice')!.productId).toBe('rice-cheap');
    expect(run({ tier: 'premium' }).lines.find((l) => l.categoryCode === 'rice')!.productId).toBe('rice-prem');
  });
  it('facts only describe things that happened', () => {
    const r = run({});
    expect(r.facts.map((f) => f.code)).toContain('planned_for');
    expect(r.facts.map((f) => f.code)).not.toContain('savings_from_alternatives');   // no budget pressure => no claimed savings
    const tight = run({ tier: 'premium', budgetMinor: 7000, budgetIncludesDelivery: true });   // premium wish + tight budget => cheaper alternatives are used
    expect(tight.facts.find((f) => f.code === 'savings_from_alternatives')?.params.savedMinor).toBeGreaterThan(0);
  });
  it('a restriction that removes a whole category is not reported as a store failure', () => {
    const r = buildBasket({ constraints: { ...defaultConstraints(), diet: ['gluten_free'] }, store, products: products.map((p) => ({ ...p, dietary: ['halal'] })), rules });
    expect(r.facts.map((f) => f.code)).toContain('category_excluded');
    expect(r.complete).toBe(true);
  });
});

describe('natural-language parser (EN / AR / mixed)', () => {
  it('parses an English request', () => {
    const r = parseRequest('Family of 4 in Dubai Marina for 1 week, budget AED 500 including delivery, halal, no sugar', areas);
    expect(r.constraints).toMatchObject({ household: 4, days: 7, budgetMinor: 50000, budgetIncludesDelivery: true, areaId: 'marina' });
    expect(r.constraints.diet).toContain('halal'); expect(r.needsConfirmation).toEqual([]);
  });
  it('parses an Arabic request with Arabic-Indic digits', () => {
    const r = parseRequest('أسرة من ٥ أفراد في دبي مارينا لمدة أسبوعين ميزانية ٦٠٠ درهم شامل التوصيل حلال', areas);
    expect(r.constraints).toMatchObject({ household: 5, days: 14, budgetMinor: 60000, budgetIncludesDelivery: true, areaId: 'marina' });
    expect(r.language).toBe('ar');
  });
  it('asks for confirmation when the budget scope is ambiguous or details are missing', () => {
    const r = parseRequest('I need groceries, 400 dirhams', areas);
    expect(r.needsConfirmation).toEqual(expect.arrayContaining(['budgetIncludesDelivery', 'household', 'days', 'areaId']));
  });
  it('detects excluded-delivery budgets and allergies', () => {
    const r = parseRequest('2 people for a month, 800 aed excluding delivery, allergic to peanuts and milk, no pork', areas);
    expect(r.constraints.budgetIncludesDelivery).toBe(false); expect(r.constraints.days).toBe(30);
    expect(r.constraints.allergens).toEqual(expect.arrayContaining(['nuts', 'dairy'])); expect(r.constraints.exclude).toContain('pork');
  });
  it('mixed-language input works', () => {
    const r = parseRequest('family of 3, JLT, أسبوع، budget 350 aed شامل التوصيل', areas);
    expect(r.constraints).toMatchObject({ household: 3, days: 7, budgetMinor: 35000, areaId: 'jlt' });
  });
});
