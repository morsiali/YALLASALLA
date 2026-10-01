import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { buildBasket, pickArea, setLang, signIn } from './helpers';

const MERCHANT = '0500000011',
  ADMIN = '0500000099';

test.describe('bilingual behaviour', () => {
  test('switching language flips direction and keeps all entered state (area, household, budget, basket)', async ({
    page,
  }) => {
    await setLang(page, 'en');
    await pickArea(page, /Dubai Marina/);
    await page.goto('/build');
    await page.getByRole('button', { name: /^Next$/ }).click();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Increase quantity' }).first().click(); // household 4 -> 6
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page.getByLabel(/Budget \(AED\)/).fill('450');
    await page.getByRole('radio', { name: /Products only/ }).click();
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByLabel('الميزانية (درهم)')).toHaveValue('450');
    await expect(page.getByRole('radio', { name: /المنتجات فقط/ })).toBeChecked();
    await page.getByRole('button', { name: /^رجوع$/ }).click();
    await expect(page.locator('output').first()).toHaveText('6');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: /^Next$/ }).click();
    await expect(page.getByLabel(/Budget \(AED\)/)).toHaveValue('450');
    // a built basket survives a language switch and a reload
    await buildBasket(page, '600');
    const total = await page.locator('.budgetbar .total').innerText();
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.budgetbar .total')).toContainText('درهم');
    await page.reload();
    await expect(page.locator('.budgetbar .total')).toContainText(total.replace('AED', '').trim());
  });

  test('Arabic basket page renders RTL with numbers kept LTR and prices in AED wording', async ({ page }) => {
    await setLang(page, 'ar');
    await pickArea(page, /مارينا/);
    await buildBasket(page, '500');
    await expect(page.locator('h1')).toHaveText('سلتك');
    await expect(page.locator('.budgetbar')).toContainText('درهم');
    expect(
      await page
        .locator('.budgetbar .money')
        .first()
        .evaluate((e) => getComputedStyle(e).direction),
    ).toBe('ltr');
    expect(await page.locator('body').evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
  });
});

test.describe('customer journey: basket → budget → checkout → tracking → points → repeat', () => {
  test('full flow with merchant fulfilment', async ({ page, browser }) => {
    await setLang(page, 'en');
    await pickArea(page, /Dubai Marina/);
    await buildBasket(page, '1000');
    const bar = page.locator('.budgetbar').first();
    await expect(bar).toContainText('Budget');
    await expect(page.getByRole('heading', { name: 'Why this basket?' })).toBeVisible();
    await expect(page.getByText(/Quantities are planned for 4 people for 7 days/)).toBeVisible();
    // essentials / health summary exist
    await expect(page.getByText('Basket health')).toBeVisible();

    // increase a quantity: the total updates immediately and the budget status reflects it
    const before = await bar.locator('.total').innerText();
    await page.getByRole('button', { name: 'Increase quantity' }).first().click();
    await expect(bar.locator('.total')).not.toHaveText(before);

    // replace an item and see the exact price effect
    await page.getByRole('button', { name: 'Replace' }).first().click();
    await expect(page.getByText('Effect on your basket').first()).toBeVisible();
    await page.getByRole('button', { name: 'Use this one' }).first().click();

    // checkout requires sign-in, but the basket and details are kept
    await page.getByRole('button', { name: 'Continue to checkout' }).first().click();
    await page.getByLabel(/^Building/).fill('Marina Tower 3');
    await page.getByLabel(/Apartment/).fill('1204');
    await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
    await page.getByRole('button', { name: /Confirm Order/ }).click();
    await page.waitForURL(/signin/);
    await page.getByLabel('UAE mobile number').fill('0507770001');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Verification code').fill('123456');
    await page.getByRole('button', { name: /^Verify$/ }).click();
    await page.waitForURL('**/checkout');
    await expect(page.getByLabel(/^Building/)).toHaveValue('Marina Tower 3'); // draft survived sign-in
    await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
    const confirm = page.getByRole('button', { name: /Confirm Order - AED/ });
    await expect(confirm).toBeEnabled();
    await confirm.dblclick(); // double tap must never create two orders
    await page.waitForURL(/\/orders\/.+placed=1/);
    await expect(page.getByText('Order received').first()).toBeVisible();
    const orderUrl = page.url().split('?')[0];
    await page.goto('/orders');
    await expect(page.locator('a.card')).toHaveCount(1);

    // merchant processes it in a separate session
    const mctx = await browser.newContext({ baseURL: 'http://localhost:5273' });
    const m = await mctx.newPage();
    await m.goto('/');
    await m.evaluate(() => {
      localStorage.setItem('yalasala.locale', 'en');
      localStorage.setItem('yalasala.areaAsked', '1');
    });
    await signIn(m, MERCHANT, '/business/orders');
    await m.locator('a.card').first().click();
    for (const next of [
      'Merchant is reviewing the basket',
      'Basket is being prepared',
      'Basket is ready',
      'Out for delivery',
      'Delivered',
    ]) {
      await m.getByRole('button', { name: new RegExp(`Move to: ${next}`) }).click();
      await expect(m.getByText(next).first()).toBeVisible();
    }
    // customer sees live tracking
    await page.goto(orderUrl);
    await expect(page.locator('.timeline .done').first()).toBeVisible();
    await expect(page.getByText('Delivered').first()).toBeVisible();
    // points are pending (not available) right after delivery
    await page.goto('/loyalty');
    await expect(page.getByText('Pending').first()).toBeVisible();
    await expect(page.getByText('How points work')).toBeVisible();
    // repeat basket shows what changed before ordering again
    await page.goto(orderUrl + '/repeat');
    await expect(page.getByRole('heading', { name: 'Repeat basket' })).toBeVisible();
    await expect(page.getByText(/Difference from last time/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue with these items' }).click();
    await page.waitForURL('**/basket');
    await mctx.close();
  });

  test('budget gate at checkout: over-budget orders need explicit approval', async ({ page }) => {
    await setLang(page, 'en');
    await pickArea(page, /Dubai Marina/);
    await buildBasket(page, '500');
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Increase quantity' }).first().click();
    await expect(page.locator('.budgetbar').first()).toContainText('Over budget');
    await signIn(page, '0507770002', '/checkout');
    await page.getByLabel(/^Building/).fill('Tower 9');
    await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
    const confirm = page.getByRole('button', { name: /Confirm Order/ });
    await expect(confirm).toBeDisabled();
    await page.getByRole('checkbox', { name: /I approve paying/ }).check();
    await expect(confirm).toBeEnabled();
  });

  test('too-low budget: honest shortfall and recovery options', async ({ page }) => {
    await setLang(page, 'en');
    await pickArea(page, /Dubai Marina/);
    await buildBasket(page, '80');
    await expect(page.getByText(/We need AED .* more to keep all essential items/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plan for fewer days' })).toBeVisible();
    await expect(page.locator('.budgetbar').first()).toContainText('Over budget');
    await expect(page.getByText(/within.*budget/i)).toHaveCount(0);
  });

  test('unsupported area gets a clear explanation and a way forward', async ({ page }) => {
    await setLang(page, 'en');
    await page.goto('/build');
    await page.getByRole('radio', { name: /Downtown Dubai/ }).click();
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page
      .getByRole('button', { name: /Build basket/ })
      .first()
      .click();
    await expect(
      page.getByText('We do not deliver to this area yet. Choose a supported area below.'),
    ).toBeVisible();
    await page.getByRole('button', { name: /Dubai Marina/ }).click();
  });

  test('substitution approval from the order screen', async ({ page, browser }) => {
    await setLang(page, 'en');
    await pickArea(page, /Dubai Marina/);
    await buildBasket(page, '900');
    await signIn(page, '0507770003', '/checkout');
    await page.getByLabel(/^Building/).fill('Tower 5');
    await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
    await page.getByRole('button', { name: /Confirm Order/ }).click();
    await page.waitForURL(/\/orders\/.+placed=1/);
    const orderUrl = page.url().split('?')[0];
    const mctx = await browser.newContext({ baseURL: 'http://localhost:5273' });
    const m = await mctx.newPage();
    await m.goto('/');
    await m.evaluate(() => {
      localStorage.setItem('yalasala.locale', 'en');
      localStorage.setItem('yalasala.areaAsked', '1');
    });
    await signIn(m, MERCHANT, '/business/orders');
    await m
      .locator('a.card', { hasText: /Tower|Customer|0507770003|#/ })
      .first()
      .click();
    await m.getByRole('button', { name: /Move to: Merchant is reviewing/ }).click();
    await expect(m.getByRole('button', { name: 'Mark unavailable' }).first()).toBeVisible();
    await m.getByRole('button', { name: 'Mark unavailable' }).first().click();
    await m.getByLabel(/Propose a replacement/).selectOption({ index: 1 });
    await m.getByRole('button', { name: 'Send' }).click();
    await expect(m.getByText(/Sent to the customer for approval|Replaced automatically/)).toBeVisible();
    await page.goto(orderUrl);
    await expect(page.getByRole('heading', { name: 'Substitution needed' })).toBeVisible();
    await expect(page.getByText('Price difference')).toBeVisible();
    await page.getByRole('button', { name: 'Accept replacement' }).click();
    await expect(page.getByRole('heading', { name: 'Substitution needed' })).toHaveCount(0);
    await mctx.close();
  });
});

test.describe('messaging and voice (test mode)', () => {
  test('customer messages a store, records a voice note, consents, transcribes (labelled test mode) and converts it to a basket', async ({
    page,
  }) => {
    await setLang(page, 'en');
    await signIn(page, '0507770004', '/stores');
    await page.getByRole('link', { name: 'Catalog' }).first().click();
    await page.getByRole('button', { name: /Message store/ }).click();
    await page.waitForURL(/\/messages\//);
    await page.getByLabel('Write a message…').fill('Do you have fresh labneh today?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Do you have fresh labneh today?')).toBeVisible();
    await expect(page.getByText(/✓ Sent/).first()).toBeVisible();
    // record 2 s of fake microphone audio
    await page.getByRole('button', { name: 'Record voice message' }).click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: /Recording/ }).click();
    await expect(page.getByText('Voice message')).toBeVisible();
    await page
      .getByLabel(/Test-mode transcript text/)
      .fill(
        'family of 3 in Dubai Marina for a week, budget 350 dirhams including delivery, no [?mushrooms?]',
      );
    await page.getByRole('button', { name: 'Transcribe' }).click();
    // consent is required first
    await expect(page.getByRole('dialog', { name: 'Allow voice transcription?' })).toBeVisible();
    await page.getByRole('button', { name: 'Allow and transcribe' }).click();
    await expect(page.getByText(/TEST MODE: this text was typed by the tester/)).toBeVisible();
    await expect(page.getByText(/Uncertain words: mushrooms/)).toBeVisible();
    await expect(page.locator('audio')).toBeVisible(); // original audio stays available
    await page.getByRole('button', { name: 'Turn into a basket' }).click();
    await page.waitForURL(/build\?mode=natural/);
    await expect(page.getByText('We understood')).toBeVisible();
    await expect(page.getByText(/350/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Build basket' }).click();
    await page.waitForURL('**/basket');
  });
});

test.describe('merchant onboarding and admin review', () => {
  test('merchant applies, admin approves with audit trail, store becomes visible', async ({
    page,
    browser,
  }) => {
    await setLang(page, 'en');
    await signIn(page, '0508880099', '/business');
    // sign-up as a business account happens on the sign-in screen
    await page.goto('/signin');
    await page.getByRole('radio', { name: 'Business' }).click();
    await page.getByLabel('UAE mobile number').fill('0508880098');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Verification code').fill('123456');
    await page.getByRole('button', { name: /^Verify$/ }).click();
    await page.waitForURL('**/business');
    await expect(page.getByRole('heading', { name: 'Open your store' })).toBeVisible();
    await page.getByLabel('Business name (English)').fill('Palm Grocers LLC');
    await page.getByLabel('Business name (Arabic)').fill('بقالة النخلة');
    await page.getByLabel('Trade licence number').fill('DED-E2E-1');
    await page.getByLabel('Contact phone').fill('+97145550000');
    await page
      .getByRole('radio', { name: /Al Barsha/ })
      .or(page.getByRole('button', { name: /Al Barsha/ }))
      .first()
      .click();
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page.getByText('Waiting for review')).toBeVisible();
    const actx = await browser.newContext({ baseURL: 'http://localhost:5273' });
    const a = await actx.newPage();
    await a.goto('/');
    await a.evaluate(() => {
      localStorage.setItem('yalasala.locale', 'en');
      localStorage.setItem('yalasala.areaAsked', '1');
    });
    await signIn(a, ADMIN, '/admin/merchants');
    await a
      .getByRole('row', { name: /Palm Grocers/ })
      .getByRole('button', { name: 'Open' })
      .click();
    await a.getByRole('button', { name: 'Approve' }).click();
    await expect(a.getByText('Decision recorded in the audit log.')).toBeVisible();
    await a.goto('/admin/audit');
    await expect(a.getByText('business.approve')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Approved and visible')).toBeVisible();
    await actx.close();
  });
});

test.describe('accessibility (axe) in both languages', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`no serious/critical violations: home, builder, basket, stores (${lang})`, async ({ page }) => {
      await setLang(page, lang);
      await pickArea(page, lang === 'en' ? /Dubai Marina/ : /مارينا/);
      const check = async (label: string) => {
        await page.waitForTimeout(400);
        const r = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(
          bad.map(
            (v) =>
              `${label}: ${v.id} ${v.nodes
                .map((n) => n.target.join(' '))
                .slice(0, 3)
                .join(' | ')}`,
          ),
          label,
        ).toEqual([]);
      };
      await page.goto('/');
      await check('home');
      await page.goto('/build');
      await check('builder');
      await page.goto('/stores');
      await check('stores');
      await page.goto('/ready');
      await check('ready');
      await buildBasket(page, '500');
      await check('basket');
      await page.goto('/checkout');
      await check('checkout');
    });
  }
});

test.describe('mobile layout', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`no horizontal scrolling on a 360px phone and the basket total stays visible while editing (${lang})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await setLang(page, lang);
      await pickArea(page, lang === 'en' ? /Dubai Marina/ : /مارينا/);
      const noOverflow = async (label: string) => {
        await page.waitForTimeout(300);
        const o = await page.evaluate(() => ({
          sw: document.scrollingElement!.scrollWidth,
          iw: window.innerWidth,
        }));
        expect(o.sw, `${label} overflows (${o.sw} > ${o.iw})`).toBeLessThanOrEqual(o.iw + 1);
      };
      for (const path of ['/', '/build', '/stores', '/ready', '/help']) {
        await page.goto(path);
        await noOverflow(path);
      }
      await buildBasket(page, '500');
      await noOverflow('/basket');
      const mini = page.locator('.minibar');
      await expect(mini).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 800));
      await expect(mini).toBeInViewport();
      await page
        .getByRole('button', { name: lang === 'en' ? 'Increase quantity' : 'زيادة الكمية' })
        .first()
        .click();
      await expect(mini).toContainText(lang === 'en' ? 'AED' : 'درهم');
    });
  }
});
