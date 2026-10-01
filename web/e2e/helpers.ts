import { expect, type Page } from '@playwright/test';

export const OTP = '123456';
export async function signIn(page: Page, phone: string, next = '/') {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/UAE mobile number|رقم الجوال الإماراتي/).fill(phone);
  await page.getByRole('button', { name: /Send code|إرسال الرمز/ }).click();
  await page.getByLabel(/Verification code|رمز التحقق/).fill(OTP);
  await page.getByRole('button', { name: /^(Verify|تحقق)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
}
export async function setLang(page: Page, lang: 'en' | 'ar') {
  await page.goto('/');
  await page.evaluate((l) => {
    localStorage.setItem('yalasala.locale', l);
    localStorage.setItem('yalasala.areaAsked', '1');
  }, lang);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}
export async function pickArea(page: Page, name: RegExp) {
  await page.getByRole('button', { name: /Change area|تغيير المنطقة/ }).click();
  await page.getByRole('radio', { name }).first().click();
  await expect(page.locator('.header .tools .pill').first()).toContainText(name);
}
/** Build a basket via the guided flow (area must already be chosen). */
export async function buildBasket(page: Page, budget: string, scope: 'incl' | 'excl' = 'incl') {
  await page.goto('/build');
  await page.getByRole('button', { name: /^(Next|التالي)$/ }).click();
  await page.getByRole('button', { name: /^(Next|التالي)$/ }).click();
  if (budget) {
    await page.getByLabel(/Budget \(AED\)|الميزانية \(درهم\)/).fill(budget);
    await page
      .getByRole('radio', {
        name:
          scope === 'incl' ? /Total including delivery|الإجمالي شامل التوصيل/ : /Products only|المنتجات فقط/,
      })
      .click();
  }
  await page
    .getByRole('button', { name: /Build basket|ابنِ السلة/ })
    .first()
    .click();
  await page.waitForURL('**/basket');
}
