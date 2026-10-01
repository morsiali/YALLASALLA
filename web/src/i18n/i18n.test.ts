import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ar } from './ar';
import { daysText, formatMoney, peopleText } from './index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('Arabic covers every English key and nothing extra', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it('no empty strings, and placeholders match between languages', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[k].trim().length, `en ${k}`).toBeGreaterThan(0);
      expect(ar[k].trim().length, `ar ${k}`).toBeGreaterThan(0);
      expect(placeholders(ar[k]), `placeholders of ${k}`).toEqual(placeholders(en[k]));
    }
  });
  it('Arabic copy contains Arabic script (catches untranslated English)', () => {
    const allowed = new Set(['nav.language', 'auth.phone.ph', 'm.pkg.price']);
    for (const k of Object.keys(ar) as (keyof typeof ar)[]) {
      if (allowed.has(k) || /^(footer\.contact|help\.contact_body)$/.test(k)) continue;
      expect(/[؀-ۿ]/.test(ar[k]), `ar ${k}: ${ar[k]}`).toBe(true);
    }
  });
  it('required brand copy is exact', () => {
    expect(en['brand.tagline']).toBe('Your household essentials, planned around your needs and budget.');
    expect(ar['brand.tagline']).toBe('احتياجات بيتك في سلة محسوبة على احتياجاتك وميزانيتك');
    expect(en['cta.build']).toBe('Build My Basket');
    expect(ar['cta.build']).toBe('ابنِ سلتك الآن');
    expect(en['cta.explore']).toBe('Explore Ready Baskets');
    expect(ar['cta.explore']).toBe('استكشف السلات الجاهزة');
    expect(en['why.title']).toBe('Why this basket?');
    expect(ar['why.title']).toBe('لماذا اخترنا هذه السلة؟');
  });
});

describe('number agreement', () => {
  it('Arabic people/days follow grammar (1, 2, 3-10, 11+) and use natural week/month words', () => {
    expect([1, 2, 4, 10, 12].map((n) => peopleText(n, 'ar'))).toEqual([
      'فرد واحد',
      'فردين',
      '4 أفراد',
      '10 أفراد',
      '12 فردًا',
    ]);
    expect([1, 2, 3, 7, 14, 30, 60, 21].map((n) => daysText(n, 'ar'))).toEqual([
      'يوم واحد',
      'يومين',
      '3 أيام',
      'أسبوع',
      'أسبوعين',
      'شهر',
      'شهرين',
      '21 يومًا',
    ]);
  });
  it('English singular/plural', () => {
    expect(peopleText(1, 'en')).toBe('1 person');
    expect(peopleText(4, 'en')).toBe('4 people');
    expect(daysText(1, 'en')).toBe('1 day');
    expect(daysText(7, 'en')).toBe('7 days');
  });
});

describe('money formatting', () => {
  it('formats AED with two decimals in both languages using Latin digits', () => {
    expect(formatMoney(49000, 'en')).toBe('AED 490.00');
    expect(formatMoney(123456, 'en')).toBe('AED 1,234.56');
    expect(formatMoney(49000, 'ar')).toBe('490.00 درهم');
    expect(formatMoney(5, 'ar')).toBe('0.05 درهم');
  });
});
