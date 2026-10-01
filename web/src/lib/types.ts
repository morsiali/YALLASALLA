export interface Area {
  id: string;
  emirate: string;
  name_en: string;
  name_ar: string;
  served: boolean;
  store_count: number;
}
export interface Money {
  minor: number;
}
export interface Line {
  productId: string;
  qty: number;
  name: { en: string; ar: string };
  brand: string;
  sizeLabel: string;
  imageUrl: string | null;
  unitPriceMinor: number;
  lineTotalMinor: number;
  compareAtMinor: number | null;
  tier: string;
  dietary: string[];
  allergens: string[];
  substitutable: boolean;
  stockQty: number;
  availability: 'in_stock' | 'limited' | 'unavailable';
  needGroup: string;
  categoryCode: string;
  priority: 'essential' | 'standard' | 'optional' | 'manual';
  reason: string;
}
export interface Totals {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  loyaltyMinor: number;
  totalMinor: number;
  offerSavingsMinor: number;
  belowMinOrder: boolean;
  minOrderMinor: number;
}
export interface BudgetStatus {
  state: 'none' | 'within' | 'close' | 'over';
  scope: 'total' | 'products';
  budgetMinor: number | null;
  spendMinor: number;
  remainingMinor: number | null;
  overByMinor: number;
}
export interface StoreView {
  id: string;
  name: { en: string; ar: string };
  deliveryFeeMinor: number;
  freeDeliveryOverMinor: number | null;
  minOrderMinor: number;
}
export interface Fact {
  code: string;
  params: Record<string, any>;
}
export interface Health {
  budgetFit: string;
  essentialsCovered: number;
  essentialsTotal: number;
  itemsInStock: number;
  itemsTotal: number;
  savingsMinor: number;
  offerSavingsMinor: number;
  household: number;
  days: number;
}
export interface Priced {
  store: StoreView;
  lines: Line[];
  totals: Totals;
  budget: BudgetStatus;
  missingEssentials: string[];
  dropped: number;
  unavailable: string[];
}

export interface Constraints {
  areaId: string | null;
  household: number;
  days: number;
  budgetMinor: number | null;
  budgetIncludesDelivery: boolean;
  scopeConfirmed: boolean;
  basketType: string;
  diet: string[];
  allergens: string[];
  exclude: string[];
  tier: string;
  brands: string[];
  mustHave: string[];
  substitutionPolicy: 'auto' | 'ask' | 'none';
  storeId: string | null;
  includeOptional: boolean;
  baby: boolean;
}
export const defaultConstraints = (): Constraints => ({
  areaId: null,
  household: 4,
  days: 7,
  budgetMinor: null,
  budgetIncludesDelivery: true,
  scopeConfirmed: false,
  basketType: 'custom',
  diet: [],
  allergens: [],
  exclude: [],
  tier: 'any',
  brands: [],
  mustHave: [],
  substitutionPolicy: 'ask',
  storeId: null,
  includeOptional: true,
  baby: false,
});
/** Strip UI-only fields before sending constraints to the API. */
export const toApiConstraints = (c: Constraints) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { scopeConfirmed, ...rest } = c;
  return rest;
};

export interface BasketDraft {
  storeId: string;
  generationId: string | null;
  source: string;
  store: StoreView;
  items: { productId: string; qty: number }[];
  facts: Fact[];
  health: Health | null;
  compared: number;
  recovery: string[];
  original: { productId: string; qty: number }[];
  reorderOf?: string | null;
  /** engine decision per product at generation time (planned / cheaper_alternative / qty_reduced / must_have) */
  reasons?: Record<string, string>;
}
