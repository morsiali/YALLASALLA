import type { Q } from '../db.js';
import { budgetStatus, priceLines } from '../domain/pricing.js';
import type { BasketResult } from '../domain/basketEngine.js';
import type {
  BasketLine,
  Constraints,
  EngineProduct,
  EngineRule,
  EngineStore,
  Fact,
} from '../domain/types.js';
import { loadRules } from './loaders.js';

export const NEED_GROUP_ORDER = [
  'essentials',
  'breakfast_dairy',
  'protein',
  'fruits_veg',
  'beverages',
  'cleaning',
  'personal_care',
  'baby_family',
  'optional',
];

export function viewLine(p: EngineProduct, qty: number, meta: Partial<BasketLine> = {}) {
  return {
    productId: p.id,
    qty,
    name: { en: p.nameEn, ar: p.nameAr },
    brand: p.brand,
    sizeLabel: p.sizeLabel,
    imageUrl: p.imageUrl,
    unitPriceMinor: p.priceMinor,
    lineTotalMinor: p.priceMinor * qty,
    compareAtMinor: p.compareAtMinor,
    tier: p.tier,
    dietary: p.dietary,
    allergens: p.allergens,
    substitutable: p.substitutable,
    stockQty: p.stockQty,
    availability: p.stockQty <= 0 ? 'unavailable' : p.stockQty < qty ? 'limited' : 'in_stock',
    needGroup: meta.needGroup ?? p.needGroup,
    categoryCode: meta.categoryCode ?? p.categoryCode,
    priority: meta.priority ?? 'manual',
    reason: meta.reason ?? 'manual',
  };
}

export function storeView(s: EngineStore) {
  return {
    id: s.id,
    name: { en: s.nameEn, ar: s.nameAr },
    deliveryFeeMinor: s.deliveryFeeMinor,
    freeDeliveryOverMinor: s.freeDeliveryOverMinor,
    minOrderMinor: s.minOrderMinor,
  };
}

export function viewBasket(result: BasketResult, products: EngineProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = result.lines.map((l) => viewLine(byId.get(l.productId)!, l.qty, l));
  return {
    store: storeView(result.store),
    lines,
    totals: result.totals,
    budget: result.budget,
    facts: result.facts,
    health: result.health,
    shortfallMinor: result.shortfallMinor,
    complete: result.complete,
  };
}

/** Reprice an arbitrary list of lines from current DB data. Used after every edit. */
export async function repriceView(
  q: Q,
  store: EngineStore,
  products: EngineProduct[],
  items: { productId: string; qty: number }[],
  c: Constraints,
  loyaltyMinor = 0,
  rules?: EngineRule[],
) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
  const ruleList = rules ?? (await loadRules(q));
  const prioByCat = new Map(ruleList.map((r) => [r.categoryCode, r.priority]));
  const valid = [...merged].filter(([id]) => byId.has(id) && byId.get(id)!.storeId === store.id);
  const priced = priceLines(
    valid.map(([id, qty]) => ({ product: byId.get(id)!, qty })),
    store,
    loyaltyMinor,
  );
  const lines = valid.map(([id, qty]) => {
    const p = byId.get(id)!;
    return viewLine(p, qty, { priority: prioByCat.get(p.categoryCode) ?? 'manual' });
  });
  const present = new Set(lines.map((l) => l.categoryCode));
  const missingEssentials = ruleList
    .filter(
      (r) =>
        r.priority === 'essential' && (r.requiresFlag !== 'baby' || c.baby) && !present.has(r.categoryCode),
    )
    .map((r) => r.categoryCode);
  const facts: Fact[] = [];
  const budget = budgetStatus(priced.totals, c.budgetMinor, c.budgetIncludesDelivery);
  return {
    store: storeView(store),
    lines,
    totals: priced.totals,
    budget,
    missingEssentials,
    facts,
    dropped: merged.size - valid.length,
    unavailable: lines.filter((l) => l.availability !== 'in_stock').map((l) => l.productId),
  };
}
