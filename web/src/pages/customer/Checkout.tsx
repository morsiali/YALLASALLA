import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, newIdempotencyKey, withRetry } from '../../lib/api';
import { toApiConstraints, type Priced } from '../../lib/types';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import { Alert, Button, Card, Chips, ErrorBox, Field, SkeletonList, TextInput } from '../../components/ui';
import { BudgetSummary } from '../../components/basket';

const DRAFT = 'yalasala.checkout.v1';
interface Draft {
  addressId: string;
  building: string;
  unit: string;
  instructions: string;
  notes: string;
  method: 'cod' | 'sandbox_card';
  token: string;
  terms: boolean;
  points: string;
}
const blank: Draft = {
  addressId: '',
  building: '',
  unit: '',
  instructions: '',
  notes: '',
  method: 'cod',
  token: 'tok_success',
  terms: false,
  points: '',
};
const loadDraft = (): Draft => {
  try {
    return { ...blank, ...(JSON.parse(localStorage.getItem(DRAFT) ?? '{}') as Partial<Draft>) };
  } catch {
    return blank;
  }
};

export default function Checkout() {
  const { t, name, money } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const { basket, form, setForm, areas, config, clearBasket } = useApp();
  const [d, setD] = useState<Draft>(loadDraft);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [loy, setLoy] = useState<any>(null);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [approveOver, setApproveOver] = useState(false);
  const idem = useRef<string>(
    (() => {
      try {
        return sessionStorage.getItem('yalasala.idem') ?? '';
      } catch {
        return '';
      }
    })() || newIdempotencyKey(),
  );
  useEffect(() => {
    try {
      sessionStorage.setItem('yalasala.idem', idem.current);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!user) return;
    api<any[]>('/me/addresses')
      .then((a) => {
        setAddresses(a);
        if (!d.addressId && !d.building && a[0]) setD((x) => ({ ...x, addressId: a[0].id }));
      })
      .catch(() => undefined);
    api('/loyalty')
      .then(setLoy)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const points = Math.max(0, parseInt(d.points || '0', 10) || 0);
  const key = JSON.stringify([
    basket?.items,
    basket?.storeId,
    points,
    form.budgetMinor,
    form.budgetIncludesDelivery,
  ]);
  useEffect(() => {
    if (!basket) return;
    let live = true;
    api<Priced>('/baskets/price', {
      body: {
        storeId: basket.storeId,
        items: basket.items,
        constraints: toApiConstraints(form),
        loyaltyPoints: points || undefined,
      },
    })
      .then((p) => live && setPriced(p))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!basket || !basket.items.length)
    return (
      <div className="stack">
        <h1>{t('checkout.title')}</h1>
        <p>{t('checkout.empty')}</p>
        <Link className="btn" to="/build">
          {t('basket.empty.cta')}
        </Link>
      </div>
    );
  if (!priced) return <SkeletonList n={4} />;

  const err = error instanceof ApiError ? error : null;
  const addr = addresses.find((a) => a.id === d.addressId);
  const areaId = addr?.area_id ?? form.areaId;
  const rules = config?.loyalty;
  const submit = async () => {
    if (!user) {
      nav('/signin?next=/checkout');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await withRetry(() =>
        api('/orders', {
          idempotencyKey: idem.current,
          body: {
            storeId: basket.storeId,
            items: basket.items,
            constraints: toApiConstraints(form),
            address: d.addressId
              ? { addressId: d.addressId, instructions: d.instructions || undefined }
              : {
                  areaId,
                  building: d.building,
                  unit: d.unit || undefined,
                  instructions: d.instructions || undefined,
                },
            notes: d.notes || undefined,
            paymentMethod: d.method,
            paymentToken: d.method === 'sandbox_card' ? d.token : undefined,
            loyaltyPoints: points || undefined,
            approveOverBudget: approveOver || undefined,
            generationId: basket.generationId,
            reorderOf: basket.reorderOf ?? undefined,
            acceptTerms: d.terms as true,
          },
        }),
      );
      try {
        sessionStorage.removeItem('yalasala.idem');
        localStorage.removeItem(DRAFT);
      } catch {
        /* ignore */
      }
      clearBasket();
      nav(`/orders/${order.order.id}?placed=1`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const missing = !d.terms || (!d.addressId && (!areaId || !d.building.trim()));
  const budgetGate = err?.code === 'BUDGET_EXCEEDED' ? err.details : null;
  const unavailable = err?.code === 'ITEMS_UNAVAILABLE' ? (err.details?.items as any[] | undefined) : null;
  const altStores =
    err?.code === 'UNSUPPORTED_AREA' ? (err.details?.alternativeStores as any[] | undefined) : null;
  return (
    <div className="stack">
      <h1>{t('checkout.title')}</h1>
      <p className="hint">
        {t('checkout.draft_saved')} {t('checkout.idem')}
      </p>
      <div className="layout-2">
        <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
          <Card className="stack">
            <h2>{t('checkout.address')}</h2>
            {addresses.length > 0 && (
              <Chips
                value={d.addressId || 'new'}
                onChange={(v: string) => set('addressId', v === 'new' ? '' : v)}
                label={t('checkout.address')}
                options={[
                  ...addresses.map((a) => ({
                    value: a.id,
                    label: `${a.label} · ${a.building}${a.unit ? ` ${a.unit}` : ''}`,
                  })),
                  { value: 'new', label: t('checkout.address.new') },
                ]}
              />
            )}
            {!d.addressId && (
              <div className="stack">
                <Field label={t('builder.area')}>
                  {(a) => (
                    <select
                      {...a}
                      className="input"
                      value={form.areaId ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, areaId: e.target.value || null }))}
                    >
                      <option value="">—</option>
                      {areas.map((x) => (
                        <option key={x.id} value={x.id}>
                          {name(x)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <TextInput
                  label={t('checkout.address.building')}
                  value={d.building}
                  onChange={(v) => set('building', v)}
                  autoComplete="address-line1"
                  required
                />
                <TextInput
                  label={t('checkout.address.unit')}
                  value={d.unit}
                  onChange={(v) => set('unit', v)}
                  autoComplete="address-line2"
                />
              </div>
            )}
            <TextInput
              label={t('checkout.address.instructions')}
              value={d.instructions}
              onChange={(v) => set('instructions', v)}
            />
            <div className="small muted">
              {t('checkout.source')}: <strong>{name(priced.store.name)}</strong> · {t('checkout.eta')}:{' '}
              {t('stores.eta_note')}
            </div>
          </Card>
          <Card className="stack">
            <h2>{t('checkout.subst')}</h2>
            <Chips
              value={form.substitutionPolicy}
              onChange={(v: any) => setForm((f) => ({ ...f, substitutionPolicy: v }))}
              label={t('checkout.subst')}
              options={['ask', 'auto', 'none'].map((x) => ({
                value: x,
                label: t(`builder.subst.${x}` as Key),
              }))}
            />
            {form.substitutionPolicy === 'auto' && (
              <p className="hint">
                {t('faq.a3')} (+{config?.autoSubstitutionMaxIncreasePct ?? 15}%)
              </p>
            )}
          </Card>
          <Card className="stack">
            <h2>{t('checkout.payment')}</h2>
            <Chips
              value={d.method}
              onChange={(v: any) => set('method', v)}
              label={t('checkout.payment')}
              options={[
                ...(config?.providers.payments.cod
                  ? [{ value: 'cod' as const, label: t('checkout.pay.cod') }]
                  : []),
                ...(config?.providers.payments.mode
                  ? [{ value: 'sandbox_card' as const, label: t('checkout.pay.card') }]
                  : []),
              ]}
            />
            {d.method === 'sandbox_card' && (
              <div className="stack">
                <Alert tone="info">
                  {t('checkout.pay.sandbox_notice')} {t('checkout.pay.card_hint')}
                </Alert>
                <Chips
                  value={d.token}
                  onChange={(v: string) => set('token', v)}
                  label={t('checkout.pay.card')}
                  options={(config?.sandboxCardTokens ?? []).map((k) => ({
                    value: k,
                    label: t(`checkout.pay.token.${k.replace('tok_', '')}` as Key),
                  }))}
                />
              </div>
            )}
          </Card>
          {user && loy && loy.available > 0 && rules && (
            <Card className="stack">
              <h2>{t('checkout.loyalty')}</h2>
              <p className="hint">
                {t('checkout.loyalty.hint', {
                  available: loy.available,
                  value: money(loy.available * rules.pointValueMinor),
                  min: rules.minRedeemPoints,
                  pct: rules.maxRedeemPctOfSubtotal,
                })}
              </p>
              <TextInput
                label={t('checkout.loyalty.apply')}
                value={d.points}
                onChange={(v) => set('points', v.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </Card>
          )}
          <Card className="stack">
            <TextInput
              label={`${t('checkout.notes')} (${t('common.optional')})`}
              value={d.notes}
              onChange={(v) => set('notes', v)}
            />
            <label className="row">
              <input
                type="checkbox"
                checked={d.terms}
                onChange={(e) => set('terms', e.target.checked)}
                style={{ width: 22, height: 22 }}
              />{' '}
              <span>
                {t('checkout.terms')} (<Link to="/legal/terms">{t('footer.terms')}</Link>,{' '}
                <Link to="/legal/privacy">{t('footer.privacy')}</Link>)
              </span>
            </label>
          </Card>
        </div>
        <aside className="stack">
          <BudgetSummary totals={priced.totals} budget={priced.budget} store={name(priced.store.name)} />
          {priced.unavailable.length > 0 && (
            <Alert tone="warn">
              {t('checkout.review_changes')} <Link to="/basket">{t('nav.basket')}</Link>
            </Alert>
          )}
          {priced.budget.state === 'over' && priced.budget.budgetMinor != null && (
            <Alert
              tone="bad"
              title={t('checkout.budget_gate', {
                budget: money(priced.budget.budgetMinor),
                total: money(priced.budget.spendMinor),
              })}
            >
              <label className="row">
                <input
                  type="checkbox"
                  checked={approveOver}
                  onChange={(e) => setApproveOver(e.target.checked)}
                  style={{ width: 22, height: 22 }}
                />{' '}
                {t('budget.approve_over', { amount: money(priced.budget.overByMinor) })}
              </label>
            </Alert>
          )}
          {budgetGate && !approveOver && <Alert tone="bad">{t('error.BUDGET_EXCEEDED')}</Alert>}
          {unavailable && (
            <Alert tone="warn" title={t('error.ITEMS_UNAVAILABLE')}>
              <ul>
                {unavailable.map((i) => (
                  <li key={i.productId}>
                    {name(i.name)} ({i.requested} → {i.available})
                  </li>
                ))}
              </ul>
              <Link to="/basket">{t('nav.basket')}</Link>
            </Alert>
          )}
          {altStores && (
            <Alert tone="warn" title={t('checkout.unsupported')}>
              <ul>
                {altStores.map((s) => (
                  <li key={s.id}>{name(s)}</li>
                ))}
              </ul>
            </Alert>
          )}
          {err && !budgetGate && !unavailable && !altStores && <ErrorBox error={err} />}
          {!user && <Alert tone="info">{t('checkout.signin_needed')}</Alert>}
          <Button
            block
            busy={busy}
            disabled={
              missing ||
              (priced.budget.state === 'over' && !approveOver) ||
              priced.totals.belowMinOrder ||
              priced.lines.some((l) => l.availability === 'unavailable')
            }
            onClick={submit}
          >
            {busy
              ? t('checkout.placing')
              : t('checkout.confirm', { amount: money(priced.totals.totalMinor) })}
          </Button>
        </aside>
      </div>
    </div>
  );
}
