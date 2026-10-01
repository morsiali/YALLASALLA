import { budgetStatus, deliveryFee, priceLines, type BudgetStatus, type Totals } from './pricing.js';
import { normalize } from './text.js';
import {
  HARD_DIET,
  type BasketLine,
  type Constraints,
  type EngineProduct,
  type EngineRule,
  type EngineStore,
  type Fact,
} from './types.js';

const FOOD_GROUPS = new Set([
  'essentials',
  'breakfast_dairy',
  'protein',
  'fruits_veg',
  'beverages',
  'optional',
]);

export interface BasketResult {
  store: EngineStore;
  lines: BasketLine[];
  totals: Totals;
  budget: BudgetStatus;
  facts: Fact[];
  health: {
    budgetFit: 'within' | 'close' | 'over' | 'none';
    essentialsCovered: number;
    essentialsTotal: number;
    itemsInStock: number;
    itemsTotal: number;
    savingsMinor: number;
    offerSavingsMinor: number;
    household: number;
    days: number;
  };
  shortfallMinor: number; // > 0 => essentials alone exceed the budget
  complete: boolean; // all essential categories covered
}

/** Hard constraint filter: allergens, hard diets, excluded terms, availability. Pure + deterministic. */
export function isEligible(p: EngineProduct, c: Constraints): boolean {
  if (p.stockQty <= 0) return false;
  if (p.allergens.some((a) => c.allergens.includes(a))) return false;
  if (FOOD_GROUPS.has(p.needGroup)) {
    for (const d of c.diet)
      if ((HARD_DIET as readonly string[]).includes(d) && !p.dietary.includes(d)) return false;
  }
  if (c.baby && p.needGroup === 'baby_family' && !p.dietary.includes('baby_safe')) return false;
  const hay = normalize(`${p.nameEn} ${p.nameAr} ${p.brand} ${p.categoryCode}`);
  for (const term of c.exclude) {
    const t = normalize(term);
    if (t.length >= 2 && hay.includes(t)) return false;
  }
  return true;
}

const tierRank = { value: 0, standard: 1, premium: 2 } as const;

function score(p: EngineProduct, c: Constraints): number {
  let s = 0;
  const hay = normalize(`${p.nameEn} ${p.nameAr}`);
  if (c.mustHave.some((m) => normalize(m).length >= 2 && hay.includes(normalize(m)))) s += 1000;
  if (c.brands.some((b) => normalize(b) === normalize(p.brand))) s += 200;
  for (const d of c.diet) if (p.dietary.includes(d)) s += 20; // soft prefs + hard-tag bonus
  if (c.tier === 'value') s += (2 - tierRank[p.tier]) * 60;
  else if (c.tier === 'premium') s += tierRank[p.tier] * 60;
  else if (c.tier === 'standard') s += p.tier === 'standard' ? 60 : 0;
  else s += p.tier === 'standard' ? 15 : 0;
  return s;
}

/** Candidates for a category ordered best-first; price breaks ties (cheaper first unless premium requested). */
export function rank(products: EngineProduct[], c: Constraints): EngineProduct[] {
  return [...products].sort((a, b) => {
    const d = score(b, c) - score(a, c);
    if (d !== 0) return d;
    const pd = c.tier === 'premium' ? b.priceMinor - a.priceMinor : a.priceMinor - b.priceMinor;
    return pd !== 0 ? pd : a.id.localeCompare(b.id);
  });
}

/**
 * Units a household needs for the period. Essentials always get at least their minimum. Non-essentials whose computed need
 * is below half a pack are skipped for this period (a single person does not need a new bottle of detergent every week).
 */
export function plannedQty(rule: EngineRule, c: Constraints): number {
  const boost = c.diet.includes('high_protein') && rule.needGroup === 'protein' ? rule.highProteinBoost : 1;
  const need = rule.unitsPerPersonWeek * boost * c.household * (c.days / 7);
  if (rule.priority !== 'essential' && need < 0.5 - 1e-9) return 0;
  return Math.max(rule.minUnits, Math.min(rule.maxUnits, Math.ceil(need - 1e-9)));
}

interface Work {
  rule: EngineRule;
  cands: EngineProduct[];
  idx: number;
  qty: number;
  removed: boolean;
  mustHave: boolean;
  swapped?: boolean;
  reduced?: boolean;
}

export function buildBasket(input: {
  constraints: Constraints;
  store: EngineStore;
  products: EngineProduct[];
  rules: EngineRule[];
}): BasketResult {
  const { constraints: c, store, rules } = input;
  const facts: Fact[] = [];
  const eligibleAll = input.products.filter((p) => p.storeId === store.id && isEligible(p, c));
  const excludedCount =
    input.products.filter((p) => p.storeId === store.id && p.stockQty > 0).length - eligibleAll.length;
  const storeCats = new Set(
    input.products.filter((p) => p.storeId === store.id && p.stockQty > 0).map((p) => p.categoryCode),
  );
  const byCat = new Map<string, EngineProduct[]>();
  for (const p of eligibleAll) byCat.set(p.categoryCode, [...(byCat.get(p.categoryCode) ?? []), p]);

  const work: Work[] = [];
  let essentialsTotal = 0;
  const missingEssentials: string[] = [];
  for (const rule of rules) {
    if (rule.requiresFlag === 'baby' && !c.baby) continue;
    if (rule.priority === 'optional' && !c.includeOptional) continue;
    const cands = rank(byCat.get(rule.categoryCode) ?? [], c);
    if (!cands.length) {
      if (storeCats.has(rule.categoryCode)) {
        // the store has it, but every product conflicts with the customer's restrictions: not a store failure
        facts.push({ code: 'category_excluded', params: { category: rule.categoryCode } });
      } else {
        if (rule.priority === 'essential') {
          essentialsTotal++;
          missingEssentials.push(rule.categoryCode);
        }
        facts.push({
          code: rule.priority === 'essential' ? 'essential_unavailable' : 'category_unavailable',
          params: { category: rule.categoryCode },
        });
      }
      continue;
    }
    if (rule.priority === 'essential') essentialsTotal++;
    const planned = plannedQty(rule, c);
    if (planned === 0) continue; // not needed for this household/period
    const qty = Math.min(planned, cands[0].stockQty);
    const hay = (p: EngineProduct) => normalize(`${p.nameEn} ${p.nameAr}`);
    work.push({
      rule,
      cands,
      idx: 0,
      qty,
      removed: false,
      mustHave: c.mustHave.some((m) => normalize(m).length >= 2 && hay(cands[0]).includes(normalize(m))),
    });
  }
  for (const m of c.mustHave) {
    const nm = normalize(m);
    if (
      nm.length >= 2 &&
      !work.some((w) => normalize(`${w.cands[w.idx].nameEn} ${w.cands[w.idx].nameAr}`).includes(nm))
    ) {
      facts.push({ code: 'must_have_missing', params: { term: m } });
    }
  }

  const live = () => work.filter((w) => !w.removed);
  const compute = () =>
    priceLines(
      live().map((w) => ({ product: w.cands[w.idx], qty: w.qty })),
      store,
    );
  const fits = () => {
    if (c.budgetMinor == null) return true;
    return budgetStatus(compute().totals, c.budgetMinor, c.budgetIncludesDelivery).state !== 'over';
  };

  let savings = 0;
  let swaps = 0;
  const optionalRemoved: string[] = [];
  const standardRemoved: string[] = [];
  let qtyReduced = 0;
  if (c.budgetMinor != null && !fits()) {
    // 1..5: progressively cheaper, always protecting essentials first. Greedy by largest saving.
    const swap = (filter: (w: Work) => boolean) => {
      let changed = false;
      while (!fits()) {
        let best: { w: Work; i: number; save: number } | null = null;
        for (const w of live().filter(filter)) {
          const cur = w.cands[w.idx];
          // the cheapest remaining candidate (respect must-have lock)
          w.cands.forEach((cand, i) => {
            const save = (cur.priceMinor - cand.priceMinor) * w.qty;
            if (cand.stockQty >= w.qty && save > 0 && !w.mustHave && (!best || save > best.save))
              best = { w, i, save };
          });
        }
        if (!best) break;
        const { w, i, save } = best as { w: Work; i: number; save: number };
        savings += save;
        swaps++;
        w.idx = i;
        w.swapped = true;
        changed = true;
      }
      return changed;
    };
    const removeAll = (filter: (w: Work) => boolean, into: string[]) => {
      while (!fits()) {
        const cand = live()
          .filter(filter)
          .sort((a, b) => b.cands[b.idx].priceMinor * b.qty - a.cands[a.idx].priceMinor * a.qty)[0];
        if (!cand) break;
        cand.removed = true;
        into.push(cand.rule.categoryCode);
      }
    };
    swap((w) => w.rule.priority !== 'essential');
    removeAll((w) => w.rule.priority === 'optional' && !w.mustHave, optionalRemoved);
    swap((w) => w.rule.priority === 'essential');
    // reduce standard quantities toward their minimum
    while (!fits()) {
      const cand = live()
        .filter((w) => w.rule.priority === 'standard' && w.qty > Math.max(1, w.rule.minUnits) && !w.mustHave)
        .sort((a, b) => b.cands[b.idx].priceMinor - a.cands[a.idx].priceMinor)[0];
      if (!cand) break;
      cand.qty -= 1;
      cand.reduced = true;
      qtyReduced++;
    }
    removeAll((w) => w.rule.priority === 'standard' && !w.mustHave, standardRemoved);
  }

  const final = live();
  const { totals } = compute();
  const budget = budgetStatus(totals, c.budgetMinor, c.budgetIncludesDelivery);
  const essentialsCovered = final.filter((w) => w.rule.priority === 'essential').length;

  facts.unshift({ code: 'planned_for', params: { household: c.household, days: c.days } });
  if (essentialsTotal > 0)
    facts.push({ code: 'essentials_first', params: { covered: essentialsCovered, total: essentialsTotal } });
  // Soft preferences are only claimed when at least one chosen product actually carries the tag.
  const prefs = c.diet.filter(
    (d) =>
      (HARD_DIET as readonly string[]).includes(d) || final.some((w) => w.cands[w.idx].dietary.includes(d)),
  );
  if (prefs.length) facts.push({ code: 'preferences_applied', params: { diet: prefs.join(',') } });
  if (c.allergens.length)
    facts.push({ code: 'allergens_excluded', params: { allergens: c.allergens.join(',') } });
  if (excludedCount > 0 && (c.allergens.length || c.exclude.length || c.diet.length))
    facts.push({ code: 'conflicts_excluded', params: { count: excludedCount } });
  if (c.budgetMinor != null) {
    facts.push({
      code: budget.state === 'over' ? 'budget_over' : 'budget_under',
      params: {
        amountMinor: budget.state === 'over' ? budget.overByMinor : (budget.remainingMinor ?? 0),
        scope: budget.scope,
      },
    });
  }
  if (swaps > 0)
    facts.push({ code: 'savings_from_alternatives', params: { savedMinor: savings, count: swaps } });
  if (optionalRemoved.length)
    facts.push({ code: 'optional_removed', params: { categories: optionalRemoved.join(',') } });
  if (qtyReduced > 0) facts.push({ code: 'qty_reduced', params: { count: qtyReduced } });
  if (standardRemoved.length)
    facts.push({ code: 'standard_removed', params: { categories: standardRemoved.join(',') } });
  if (totals.belowMinOrder)
    facts.push({ code: 'below_min_order', params: { minOrderMinor: totals.minOrderMinor } });

  const lines: BasketLine[] = final.map((w) => ({
    productId: w.cands[w.idx].id,
    qty: w.qty,
    categoryCode: w.rule.categoryCode,
    needGroup: w.rule.needGroup,
    priority: w.rule.priority,
    reason: w.mustHave
      ? 'must_have'
      : w.reduced
        ? 'qty_reduced'
        : w.swapped
          ? 'cheaper_alternative'
          : 'planned',
  }));
  const inStock = final.filter((w) => w.cands[w.idx].stockQty >= w.qty).length;
  return {
    store,
    lines,
    totals,
    budget,
    facts,
    health: {
      budgetFit: budget.state,
      essentialsCovered,
      essentialsTotal,
      itemsInStock: inStock,
      itemsTotal: final.length,
      savingsMinor: savings,
      offerSavingsMinor: totals.offerSavingsMinor,
      household: c.household,
      days: c.days,
    },
    shortfallMinor: budget.state === 'over' ? budget.overByMinor : 0,
    complete: missingEssentials.length === 0,
  };
}

/** Pick the best single store among candidates: complete essentials, then within budget, then lowest total. */
export function buildBestBasket(input: {
  constraints: Constraints;
  stores: EngineStore[];
  products: EngineProduct[];
  rules: EngineRule[];
}): (BasketResult & { compared: number }) | null {
  const results = input.stores.map((store) => buildBasket({ ...input, store }));
  if (!results.length) return null;
  results.sort(
    (a, b) =>
      Number(b.complete) - Number(a.complete) ||
      Number(a.budget.state === 'over') - Number(b.budget.state === 'over') ||
      b.health.essentialsCovered - a.health.essentialsCovered ||
      a.totals.totalMinor - b.totals.totalMinor,
  );
  const best = results[0];
  best.facts.push({ code: 'store_chosen', params: { store: best.store.id, compared: results.length } });
  return Object.assign(best, { compared: results.length });
}

export { deliveryFee };
