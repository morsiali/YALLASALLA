export type Tier = 'value' | 'standard' | 'premium';
export type SubstitutionPolicy = 'auto' | 'ask' | 'none';
export type BasketType = 'family_weekly' | 'budget' | 'single' | 'monthly' | 'baby' | 'healthy' | 'custom';

/** Hard dietary constraints (filter) vs soft preferences (ranking boost). */
export const HARD_DIET = ['halal', 'vegetarian', 'gluten_free'] as const;
export const SOFT_DIET = ['organic', 'high_protein', 'low_sugar'] as const;
export const ALLERGENS = ['nuts', 'dairy', 'gluten', 'eggs', 'soy', 'fish'] as const;

export interface Constraints {
  areaId: string | null;
  household: number;
  days: number;
  budgetMinor: number | null;
  budgetIncludesDelivery: boolean;
  basketType: BasketType;
  diet: string[];
  allergens: string[];
  exclude: string[];
  tier: Tier | 'any';
  brands: string[];
  mustHave: string[];
  substitutionPolicy: SubstitutionPolicy;
  storeId: string | null;
  includeOptional: boolean;
  baby: boolean;
}

export const defaultConstraints = (): Constraints => ({
  areaId: null,
  household: 2,
  days: 7,
  budgetMinor: null,
  budgetIncludesDelivery: true,
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

export interface EngineProduct {
  id: string;
  storeId: string;
  categoryCode: string;
  needGroup: string;
  nameEn: string;
  nameAr: string;
  brand: string;
  sizeLabel: string;
  priceMinor: number;
  compareAtMinor: number | null;
  stockQty: number;
  tier: Tier;
  dietary: string[];
  allergens: string[];
  imageUrl: string | null;
  substitutable: boolean;
}
export interface EngineRule {
  categoryCode: string;
  needGroup: string;
  unitsPerPersonWeek: number;
  priority: 'essential' | 'standard' | 'optional';
  minUnits: number;
  maxUnits: number;
  requiresFlag: 'baby' | null;
  highProteinBoost: number;
}
export interface EngineStore {
  id: string;
  nameEn: string;
  nameAr: string;
  deliveryFeeMinor: number;
  freeDeliveryOverMinor: number | null;
  minOrderMinor: number;
}
export interface Fact {
  code: string;
  params: Record<string, string | number | boolean | null>;
}
export interface BasketLine {
  productId: string;
  qty: number;
  categoryCode: string;
  needGroup: string;
  priority: 'essential' | 'standard' | 'optional' | 'manual';
  /** Why this line looks the way it does (traceable to an engine decision). */
  reason: 'planned' | 'cheaper_alternative' | 'qty_reduced' | 'must_have' | 'manual';
}
