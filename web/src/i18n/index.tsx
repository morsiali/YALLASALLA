import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Key } from './en';
import { ar } from './ar';

export type Locale = 'ar' | 'en';
const dict = { en, ar } as const;
const STORE = 'yalasala.locale';

export function formatMoney(minor: number, locale: Locale): string {
  const v = (minor / 100).toLocaleString(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return locale === 'ar' ? `${v} درهم` : `AED ${v}`;
}
/** Grammatical "N people" / "N days" in both languages (Arabic number agreement: 1, 2, 3–10 plural, 11+ singular accusative). */
export function peopleText(n: number, l: Locale): string {
  if (l === 'en') return n === 1 ? '1 person' : `${n} people`;
  if (n === 1) return 'فرد واحد';
  if (n === 2) return 'فردين';
  return n <= 10 ? `${n} أفراد` : `${n} فردًا`;
}
export function daysText(n: number, l: Locale): string {
  if (l === 'en') return n === 1 ? '1 day' : `${n} days`;
  const nat: Record<number, string> = {
    1: 'يوم واحد',
    2: 'يومين',
    7: 'أسبوع',
    14: 'أسبوعين',
    30: 'شهر',
    60: 'شهرين',
  };
  if (nat[n]) return nat[n];
  return n <= 10 ? `${n} أيام` : `${n} يومًا`;
}
export function formatDate(iso: string, locale: Locale, withTime = true): string {
  return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    timeZone: 'Asia/Dubai',
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  });
}

interface I18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (l: Locale) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  /** Translate a server error code if we have copy for it, else fall back to the server message. */
  tError: (code: string | undefined, fallback?: string) => string;
  money: (minor: number) => string;
  people: (n: number) => string;
  days: (n: number) => string;
  date: (iso: string, withTime?: boolean) => string;
  name: (o: { en: string; ar: string } | { name_en: string; name_ar: string } | null | undefined) => string;
}
const Ctx = createContext<I18n>(null as unknown as I18n);
export const useI18n = () => useContext(Ctx);

function initial(): Locale {
  try {
    const s = localStorage.getItem(STORE);
    if (s === 'ar' || s === 'en') return s;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setL] = useState<Locale>(initial);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem(STORE, locale);
    } catch {
      /* ignore */
    }
  }, [locale, dir]);
  const setLocale = useCallback((l: Locale) => setL(l), []);
  const value = useMemo<I18n>(() => {
    const d = dict[locale] as Record<string, string>;
    const t: I18n['t'] = (key, params) => {
      let s = d[key] ?? (en as Record<string, string>)[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    return {
      locale,
      dir,
      setLocale,
      t,
      tError: (code, fallback) => {
        const k = `error.${code}`;
        return d[k] ?? fallback ?? d['error.generic'];
      },
      money: (m) => formatMoney(m, locale),
      people: (n) => peopleText(n, locale),
      days: (n) => daysText(n, locale),
      date: (iso, withTime = true) => formatDate(iso, locale, withTime),
      name: (o) => {
        if (!o) return '';
        const x = o as any;
        return locale === 'ar' ? (x.ar ?? x.name_ar) : (x.en ?? x.name_en);
      },
    };
  }, [locale, dir, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
