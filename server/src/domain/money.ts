export const toMinor = (aed: number) => Math.round(aed * 100);
export function formatAed(minor: number, locale: 'en' | 'ar' = 'en'): string {
  const v = (minor / 100).toLocaleString(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return locale === 'ar' ? `${v} د.إ` : `AED ${v}`;
}
