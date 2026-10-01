import type { EngineProduct, EngineStore } from './types.js';

export function deliveryFee(store: EngineStore, subtotalMinor: number): number {
  if (subtotalMinor <= 0) return 0;
  if (store.freeDeliveryOverMinor != null && subtotalMinor >= store.freeDeliveryOverMinor) return 0;
  return store.deliveryFeeMinor;
}

export interface PricedLine {
  productId: string; qty: number; unitPriceMinor: number; lineTotalMinor: number;
  availability: 'in_stock' | 'limited' | 'unavailable'; stockQty: number;
}
export interface Totals {
  subtotalMinor: number; discountMinor: number; deliveryFeeMinor: number; loyaltyMinor: number; totalMinor: number;
  offerSavingsMinor: number; belowMinOrder: boolean; minOrderMinor: number;
}

export function priceLines(
  lines: { product: EngineProduct; qty: number }[], store: EngineStore, loyaltyMinor = 0,
): { lines: PricedLine[]; totals: Totals } {
  const priced = lines.map(({ product: p, qty }) => ({
    productId: p.id, qty, unitPriceMinor: p.priceMinor, lineTotalMinor: p.priceMinor * qty, stockQty: p.stockQty,
    availability: (p.stockQty <= 0 ? 'unavailable' : p.stockQty < qty ? 'limited' : 'in_stock') as PricedLine['availability'],
  }));
  const subtotal = priced.reduce((s, l) => s + l.lineTotalMinor, 0);
  const offerSavings = lines.reduce((s, { product: p, qty }) => s + (p.compareAtMinor ? (p.compareAtMinor - p.priceMinor) * qty : 0), 0);
  const delivery = deliveryFee(store, subtotal);
  const loyalty = Math.min(loyaltyMinor, subtotal);
  return {
    lines: priced,
    totals: {
      subtotalMinor: subtotal, discountMinor: 0, deliveryFeeMinor: delivery, loyaltyMinor: loyalty,
      totalMinor: subtotal + delivery - loyalty, offerSavingsMinor: offerSavings,
      belowMinOrder: subtotal > 0 && subtotal < store.minOrderMinor, minOrderMinor: store.minOrderMinor,
    },
  };
}

export type BudgetState = 'none' | 'within' | 'close' | 'over';
export interface BudgetStatus {
  state: BudgetState; scope: 'total' | 'products'; budgetMinor: number | null;
  spendMinor: number; remainingMinor: number | null; overByMinor: number;
}
/**
 * Budget scope matters: with a total budget the FINAL checkout amount (incl. delivery, after loyalty) is compared;
 * with a product-only budget only the product value is, and delivery is shown separately by the UI.
 * "close" = within 5% of the budget (or AED 5) — amber, never green.
 */
export function budgetStatus(t: Totals, budgetMinor: number | null, includesDelivery: boolean): BudgetStatus {
  const scope = includesDelivery ? 'total' : 'products';
  const spend = includesDelivery ? t.totalMinor : t.subtotalMinor - t.discountMinor;
  if (budgetMinor == null) return { state: 'none', scope, budgetMinor, spendMinor: spend, remainingMinor: null, overByMinor: 0 };
  const remaining = budgetMinor - spend;
  const state: BudgetState = remaining < 0 ? 'over' : remaining <= Math.max(500, Math.round(budgetMinor * 0.05)) ? 'close' : 'within';
  return { state, scope, budgetMinor, spendMinor: spend, remainingMinor: remaining, overByMinor: Math.max(0, -remaining) };
}
