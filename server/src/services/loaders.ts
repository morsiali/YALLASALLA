import type { Q } from '../db.js';
import type { EngineProduct, EngineRule, EngineStore } from '../domain/types.js';

const PRODUCT_SQL = `
  select p.id, p.store_id, c.code as category_code, c.need_group, p.name_en, p.name_ar, p.brand, p.size_label,
         p.price_minor, p.compare_at_minor, p.stock_qty, p.tier, p.dietary, p.allergens, p.image_url, p.substitutable
  from products p join categories c on c.id = p.category_id`;

export const mapProduct = (r: any): EngineProduct => ({
  id: r.id, storeId: r.store_id, categoryCode: r.category_code, needGroup: r.need_group, nameEn: r.name_en, nameAr: r.name_ar,
  brand: r.brand, sizeLabel: r.size_label, priceMinor: r.price_minor, compareAtMinor: r.compare_at_minor, stockQty: r.stock_qty,
  tier: r.tier, dietary: r.dietary, allergens: r.allergens, imageUrl: r.image_url, substitutable: r.substitutable,
});
export const mapStore = (r: any): EngineStore => ({
  id: r.id, nameEn: r.name_en, nameAr: r.name_ar, deliveryFeeMinor: r.delivery_fee_minor,
  freeDeliveryOverMinor: r.free_delivery_over_minor, minOrderMinor: r.min_order_minor,
});

export async function loadProducts(q: Q, storeIds: string[]): Promise<EngineProduct[]> {
  if (!storeIds.length) return [];
  const { rows } = await q.query(`${PRODUCT_SQL} where p.active and p.store_id = any($1::uuid[]) order by c.sort_order, p.price_minor, p.id`, [storeIds]);
  return rows.map(mapProduct);
}
export async function loadProductsByIds(q: Q, ids: string[], lock = false): Promise<EngineProduct[]> {
  if (!ids.length) return [];
  const { rows } = await q.query(`${PRODUCT_SQL} where p.id = any($1::uuid[]) order by p.id ${lock ? 'for update of p' : ''}`, [ids]);
  return rows.map(mapProduct);
}
export async function loadRules(q: Q): Promise<EngineRule[]> {
  const { rows } = await q.query(
    `select c.code, c.need_group, r.units_per_person_week, r.priority, r.min_units, r.max_units, r.requires_flag, r.high_protein_boost
     from basket_rules r join categories c on c.id = r.category_id where r.active order by c.sort_order`);
  return rows.map((r) => ({
    categoryCode: r.code, needGroup: r.need_group, unitsPerPersonWeek: Number(r.units_per_person_week), priority: r.priority,
    minUnits: r.min_units, maxUnits: r.max_units, requiresFlag: r.requires_flag, highProteinBoost: Number(r.high_protein_boost),
  }));
}
/** Stores that are approved + active and actually serve the area. */
export async function loadStoresForArea(q: Q, areaId: string): Promise<EngineStore[]> {
  const { rows } = await q.query(
    `select s.* from stores s join businesses b on b.id = s.business_id join store_areas sa on sa.store_id = s.id
     where sa.area_id = $1 and s.active and b.status = 'approved' order by s.created_at`, [areaId]);
  return rows.map(mapStore);
}
export async function loadStore(q: Q, id: string): Promise<EngineStore | null> {
  const { rows } = await q.query('select * from stores where id = $1', [id]);
  return rows[0] ? mapStore(rows[0]) : null;
}
