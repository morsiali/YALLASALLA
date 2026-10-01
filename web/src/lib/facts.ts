import { useEffect, useState } from 'react';
import { api } from './api';
import type { Fact, Line } from './types';
import type { Key } from '../i18n/en';

export interface Category {
  code: string;
  name_en: string;
  name_ar: string;
  need_group: string;
}
let cache: Record<string, Category> | null = null;
let pending: Promise<void> | null = null;
export function useCategories(): Record<string, Category> {
  const [c, setC] = useState<Record<string, Category>>(cache ?? {});
  useEffect(() => {
    if (cache) return;
    pending ??= api<Category[]>('/categories').then((rows) => {
      cache = Object.fromEntries(rows.map((r) => [r.code, r]));
    });
    pending.then(() => setC(cache ?? {})).catch(() => undefined);
  }, []);
  return c;
}

interface Deps {
  t: (k: Key, p?: Record<string, string | number>) => string;
  money: (m: number) => string;
  locale: 'ar' | 'en';
  cats: Record<string, Category>;
  people: (n: number) => string;
  days: (n: number) => string;
}
/** Render a recorded engine decision in the customer's language. Only facts the engine actually emitted are shown. */
export function factText(f: Fact, d: Deps, _lines?: Line[]): string {
  const { t, money, locale, cats, people, days } = d;
  const cat = (code: string) => {
    const c = cats[code];
    return c ? (locale === 'ar' ? c.name_ar : c.name_en) : code;
  };
  const list = (s: string, prefix: 'diet' | 'allergen') =>
    String(s)
      .split(',')
      .filter(Boolean)
      .map((x) => t(`${prefix}.${x}` as Key))
      .join(locale === 'ar' ? '، ' : ', ');
  const p = f.params;
  switch (f.code) {
    case 'planned_for':
      return t('fact.planned_for', { household: people(Number(p.household)), days: days(Number(p.days)) });
    case 'essentials_first':
      return t('fact.essentials_first', { covered: p.covered, total: p.total });
    case 'preferences_applied':
      return t('fact.preferences_applied', { diet: list(p.diet, 'diet') });
    case 'allergens_excluded':
      return t('fact.allergens_excluded', { allergens: list(p.allergens, 'allergen') });
    case 'conflicts_excluded':
      return t('fact.conflicts_excluded', { count: p.count });
    case 'budget_under':
      return t('fact.budget_under', { amount: money(Number(p.amountMinor)) });
    case 'budget_over':
      return t('fact.budget_over', { amount: money(Number(p.amountMinor)) });
    case 'savings_from_alternatives':
      return t('fact.savings_from_alternatives', { savedMinor: money(Number(p.savedMinor)), count: p.count });
    case 'optional_removed':
      return t('fact.optional_removed', {
        categories: String(p.categories)
          .split(',')
          .map(cat)
          .join(locale === 'ar' ? '، ' : ', '),
      });
    case 'standard_removed':
      return t('fact.standard_removed', {
        categories: String(p.categories)
          .split(',')
          .map(cat)
          .join(locale === 'ar' ? '، ' : ', '),
      });
    case 'qty_reduced':
      return t('fact.qty_reduced', { count: p.count });
    case 'below_min_order':
      return t('fact.below_min_order', { minOrderMinor: money(Number(p.minOrderMinor)) });
    case 'store_chosen':
      return t('fact.store_chosen', { compared: p.compared });
    case 'essential_unavailable':
      return t('fact.essential_unavailable', { category: cat(String(p.category)) });
    case 'category_unavailable':
      return t('fact.category_unavailable', { category: cat(String(p.category)) });
    case 'category_excluded':
      return t('fact.category_excluded', { category: cat(String(p.category)) });
    case 'must_have_missing':
      return t('fact.must_have_missing', { term: String(p.term) });
    default:
      return '';
  }
}
