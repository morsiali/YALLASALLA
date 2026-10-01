import { hasArabic, normalize } from './text.js';
import { defaultConstraints, type BasketType, type Constraints } from './types.js';

export interface AreaRef { id: string; nameEn: string; nameAr: string }
export interface ParseResult {
  language: 'ar' | 'en';
  constraints: Constraints;
  detected: string[];         // fields that were read from the text
  needsConfirmation: string[]; // fields that are missing or ambiguous and MUST be confirmed by the customer
}

const NUMWORDS: Record<string, number> = {
  واحد: 1, اثنين: 2, اثنان: 2, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, ثمانيه: 8, تسعه: 9, عشره: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const ALLERGEN_WORDS: Record<string, string> = {
  nut: 'nuts', nuts: 'nuts', peanut: 'nuts', peanuts: 'nuts', مكسرات: 'nuts', 'فول سوداني': 'nuts',
  milk: 'dairy', dairy: 'dairy', lactose: 'dairy', حليب: 'dairy', لاكتوز: 'dairy', البان: 'dairy',
  gluten: 'gluten', غلوتين: 'gluten', قمح: 'gluten', egg: 'eggs', eggs: 'eggs', بيض: 'eggs',
  soy: 'soy', صويا: 'soy', fish: 'fish', سمك: 'fish',
};

export function parseRequest(text: string, areas: AreaRef[]): ParseResult {
  const language = hasArabic(text) ? 'ar' : 'en';
  let t = ` ${normalize(text)} `;
  const c = defaultConstraints();
  const detected: string[] = [];
  // number words -> digits (word-boundary safe for both scripts)
  for (const [w, n] of Object.entries(NUMWORDS)) t = t.replace(new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'gu'), String(n));

  // budget (parsed first so its digits are not read as household size)
  const cur = '(?:aed|dhs?|dirhams?|درهم|دراهم)';
  const money = [new RegExp(`${cur}\\s*(\\d[\\d,]*(?:\\.\\d+)?)`), new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${cur}`), /(?:budget|ميزانيه|ميزانيتي)\s*(?:of|is|:|هي|بقيمه)?\s*(\d[\d,]*)/];
  for (const re of money) {
    const m = t.match(re);
    if (m) { c.budgetMinor = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100); t = t.replace(m[0], ' '); detected.push('budget'); break; }
  }
  // delivery scope
  const excl = /(excluding|without|before|plus|not including|exclude)\s+delivery|delivery\s+(is\s+)?(not included|extra|separate)|بدون\s+(ال)?توصيل|غير شامل\s+(ال)?توصيل|(ال)?توصيل\s+(منفصل|اضافي)/;
  const incl = /(including|incl\.?|inclusive of|with)\s+delivery|delivery\s+(is\s+)?included|شامل\s+(ال)?توصيل|مع\s+(ال)?توصيل|بالتوصيل/;
  let scopeKnown = false;
  if (excl.test(t)) { c.budgetIncludesDelivery = false; scopeKnown = true; t = t.replace(excl, ' '); detected.push('budgetIncludesDelivery'); }
  else if (incl.test(t)) { c.budgetIncludesDelivery = true; scopeKnown = true; t = t.replace(incl, ' '); detected.push('budgetIncludesDelivery'); }

  // duration
  const dur = t.match(/(\d+)\s*(days?|يوم|ايام)/);
  const wk = t.match(/(?:(\d+)\s*)?(weeks?|اسبوع|اسابيع)/);
  const mo = t.match(/(?:(\d+)\s*)?(months?|شهر|شهور|اشهر)/);
  if (/اسبوعين/.test(t)) { c.days = 14; detected.push('days'); }
  else if (/شهرين/.test(t)) { c.days = 60; detected.push('days'); }
  else if (dur) { c.days = Math.min(62, parseInt(dur[1], 10)); detected.push('days'); }
  else if (wk) { c.days = Math.min(62, 7 * (wk[1] ? parseInt(wk[1], 10) : 1)); detected.push('days'); }
  else if (mo) { c.days = Math.min(62, 30 * (mo[1] ? parseInt(mo[1], 10) : 1)); detected.push('days'); }
  if (dur) t = t.replace(dur[0], ' ');

  // household
  const hh =
    t.match(/(?:family|household|group|team)\s*(?:of|for)?\s*(\d{1,2})/) ||
    t.match(/(\d{1,2})\s*(?:people|persons?|members?|adults?|kids|children|individuals)/) ||
    t.match(/(\d{1,2})\s*(?:افراد|فرد|اشخاص|شخص|اولاد|اطفال)/) ||
    t.match(/(?:اسره|عايله|عائله|بيت)\s*(?:من|مكونه من|مكونة من)?\s*(\d{1,2})/) ||
    t.match(/(?:for|لـ?)\s*(\d{1,2})\b/);
  if (hh) { c.household = Math.max(1, Math.min(12, parseInt(hh[1], 10))); detected.push('household'); }
  else if (/just me|myself|living alone|for one\b|single person|لوحدي|فرد واحد|شخص واحد|انا فقط/.test(t)) { c.household = 1; detected.push('household'); }
  else if (/couple|زوجين|انا وزوجتي|انا وزوجي/.test(t)) { c.household = 2; detected.push('household'); }

  // diet preferences
  const diet: [RegExp, string][] = [
    [/halal|حلال/, 'halal'], [/vegetarian|veggie|vegan|نباتي|نباتيه/, 'vegetarian'],
    [/high[- ]protein|protein[- ]rich|بروتين عالي|غني بالبروتين|بروتين اكثر/, 'high_protein'],
    [/low[- ]sugar|sugar[- ]free|قليل السكر|بدون سكر|خالي من السكر/, 'low_sugar'],
    [/gluten[- ]free|خالي من (ال)?غلوتين|بدون غلوتين/, 'gluten_free'], [/organic|عضوي|عضويه/, 'organic'],
  ];
  for (const [re, tag] of diet) if (re.test(t)) { c.diet.push(tag); detected.push('diet'); if (tag === 'low_sugar') t = t.replace(re, ' '); }
  if (/baby|infant|toddler|newborn|diaper|حفاض|رضيع|طفل صغير|مولود/.test(t)) { c.baby = true; c.basketType = 'baby'; detected.push('baby'); }

  // allergens: "allergic to X", "allergy: X", "حساسية من X"
  const al = [...t.matchAll(/(?:allerg(?:y|ic|ies)\s*(?:to|:)?|حساسيه\s*(?:من)?)\s*([a-z؀-ۿ ,&]+?)(?=[.;!?]|\s(?:with|for|no|without|budget)\s|\s*$|,\s*(?:no|for|budget|without))/g)];
  for (const m of al) {
    for (const w of m[1].split(/,|&|\band\b|\sو/).map((x) => x.trim()).filter(Boolean)) {
      const key = ALLERGEN_WORDS[w] ?? ALLERGEN_WORDS[w.replace(/s$/, '')];
      if (key && !c.allergens.includes(key)) c.allergens.push(key);
    }
  }
  if (c.allergens.length) detected.push('allergens');

  // exclusions: "no pork", "without sugar", "avoid X", "بدون X", "من غير X"
  const ex = [...t.matchAll(/(?:\bno\b|\bwithout\b|\bavoid\b|\bexclude\b|\bexcluding\b|بدون|من غير|ما ابي|لا اريد)\s+([a-z؀-ۿ]+)/g)];
  const stop = new Set(['delivery', 'the', 'a', 'any', 'extra', 'التوصيل', 'توصيل', 'ال', 'sugar-free']);
  for (const m of ex) {
    const w = m[1];
    if (stop.has(w) || /^\d/.test(w)) continue;
    const mapped = ALLERGEN_WORDS[w];
    if (mapped && !c.allergens.includes(mapped) && /allerg|حساسيه/.test(t)) continue;
    if (!c.exclude.includes(w)) c.exclude.push(w);
  }
  if (c.exclude.length) detected.push('exclude');

  // basket type hints
  if (c.basketType === 'custom') {
    if (/healthy|صحي|diet|رجيم/.test(t)) c.basketType = 'healthy';
    else if (/cheap|budget|economical|اقتصادي|ارخص|توفير|وفر/.test(t)) c.basketType = 'budget';
    else if (c.household === 1 && detected.includes('household')) c.basketType = 'single';
    else if (c.days >= 28) c.basketType = 'monthly';
    else if (detected.includes('household')) c.basketType = 'family_weekly';
  }
  if (c.basketType === 'healthy') c.includeOptional = false;
  if (c.basketType === 'budget') c.tier = 'value';
  if (/premium|best quality|افضل جوده|جوده عاليه/.test(t)) c.tier = 'premium';
  if (/ask me before|اسالني قبل|استشيرني/.test(t)) c.substitutionPolicy = 'ask';
  else if (/no substitut|do not substitute|بدون بدائل|لا تستبدل/.test(t)) c.substitutionPolicy = 'none';

  // area: longest match first
  const sorted = [...areas].sort((a, b) => b.nameEn.length - a.nameEn.length);
  for (const a of sorted) {
    if (t.includes(normalize(a.nameEn)) || t.includes(normalize(a.nameAr))) { c.areaId = a.id; detected.push('areaId'); break; }
  }
  if (/\bjlt\b|jumeirah lakes/.test(t) && !c.areaId) {
    const jlt = areas.find((a) => /jumeirah lakes|jlt/i.test(a.nameEn));
    if (jlt) { c.areaId = jlt.id; detected.push('areaId'); }
  }

  const needs: string[] = [];
  if (!detected.includes('areaId')) needs.push('areaId');
  if (!detected.includes('household')) needs.push('household');
  if (!detected.includes('days')) needs.push('days');
  if (!detected.includes('budget')) needs.push('budget');
  else if (!scopeKnown) needs.push('budgetIncludesDelivery');   // a budget without a stated scope is ambiguous
  return { language, constraints: { ...c, basketType: c.basketType as BasketType }, detected: [...new Set(detected)], needsConfirmation: needs };
}
