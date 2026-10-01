import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import { toApiConstraints } from '../../lib/types';
import { Alert, Badge, Button, Card, ErrorBox, Field, Money, SkeletonList, toast } from '../../components/ui';
import { BasketEditor, BudgetSummary, WhyPanel } from '../../components/basket';
import { generateBasket } from './Builder';

function Recovery() {
  const { t, name, money } = useI18n();
  const { form, setForm, basket, setBasket, priced, setQty } = useApp();
  const [raise, setRaise] = useState('');
  const [stores, setStores] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!priced || priced.budget.state !== 'over' || form.budgetMinor == null) return null;
  const regen = async (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setBusy(true);
    setError(null);
    try {
      await generateBasket(next, basket?.source ?? 'guided', false, setBasket);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Alert tone="bad" title={t('budget.shortfall', { amount: money(priced.budget.overByMinor) })}>
      <p style={{ margin: '6px 0' }}>{t('budget.options')}</p>
      <div className="stack">
        <div className="row">
          <Field label={t('budget.raise_to')}>
            {(a) => (
              <input
                {...a}
                className="input"
                inputMode="decimal"
                value={raise}
                onChange={(e) => setRaise(e.target.value)}
                style={{ width: 140 }}
              />
            )}
          </Field>
          <Button
            size="small"
            onClick={() => {
              const n = parseFloat(raise);
              if (n > 0) {
                setForm((f) => ({ ...f, budgetMinor: Math.round(n * 100) }));
                setRaise('');
              }
            }}
          >
            {t('budget.apply')}
          </Button>
        </div>
        <div className="row">
          <Button
            size="small"
            variant="secondary"
            busy={busy}
            onClick={() => regen({ days: Math.max(1, Math.round(form.days * 0.7)) })}
          >
            {t('budget.opt.reduce_duration')}
          </Button>
          <Button
            size="small"
            variant="secondary"
            busy={busy}
            disabled={form.household <= 1}
            onClick={() => regen({ household: Math.max(1, form.household - 1) })}
          >
            {t('budget.opt.reduce_household')}
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() =>
              priced.lines.filter((l) => l.priority === 'optional').forEach((l) => setQty(l.productId, 0))
            }
          >
            {t('budget.opt.remove_optional')}
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={async () => {
              try {
                setStores(
                  await api('/baskets/compare-stores', {
                    body: { constraints: toApiConstraints(form), budgetScopeConfirmed: true },
                  }),
                );
              } catch (e) {
                setError(e);
              }
            }}
          >
            {t('budget.opt.switch_store')}
          </Button>
        </div>
        {stores && (
          <div className="stack">
            {stores.map((s) => (
              <div key={s.storeId} className="row between card flat">
                <div>
                  <div className="strong">{name(s.name)}</div>
                  <div className="small muted">
                    <Money minor={s.totalMinor} />
                  </div>
                </div>
                <Button
                  size="small"
                  disabled={s.storeId === basket?.storeId}
                  onClick={() => regen({ storeId: s.storeId })}
                >
                  {t('ready.use')}
                </Button>
              </div>
            ))}
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Alert>
  );
}

export default function BasketPage() {
  const { t, name } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const { basket, priced, pricing, priceError, form, setQty, replaceItem, clearBasket } = useApp();
  const [saving, setSaving] = useState(false);
  const reasons = basket?.reasons ?? {};
  const origIds = new Set((basket?.original ?? []).map((i) => i.productId));
  const shown = priced
    ? {
        ...priced,
        lines: priced.lines.map((l) => ({
          ...l,
          reason: reasons[l.productId] ?? (origIds.has(l.productId) ? 'planned' : 'manual'),
        })),
      }
    : null;
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!basket || !basket.items.length) {
    return (
      <div className="stack" style={{ textAlign: 'center', padding: '40px 0' }}>
        <h1>{t('basket.title')}</h1>
        <p className="muted">{t('basket.empty')}</p>
        <div>
          <Link className="btn" to="/build">
            {t('basket.empty.cta')}
          </Link>
        </div>
      </div>
    );
  }
  const save = async () => {
    if (!user) {
      nav(`/signin?next=/basket`);
      return;
    }
    const nm = window.prompt(t('saved.name'), name(basket.store.name));
    if (!nm) return;
    setSaving(true);
    setError(null);
    try {
      await api('/saved/baskets', {
        body: { name: nm, storeId: basket.storeId, items: basket.items, constraints: toApiConstraints(form) },
      });
      toast(t('basket.saved'));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  const ask = async () => {
    if (!user) {
      nav('/signin?next=/basket');
      return;
    }
    setAsking(true);
    setError(null);
    try {
      const c = await api('/conversations', {
        body: {
          storeId: basket.storeId,
          ...(basket.generationId ? { ref: { type: 'basket', id: basket.generationId } } : {}),
        },
      });
      nav(`/messages/${c.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('basket.title')}</h1>
        <div className="row">
          <Link to="/build" className="btn ghost small">
            {t('common.edit')}
          </Link>
          <Button size="small" variant="ghost" onClick={clearBasket}>
            {t('builder.discard')}
          </Button>
        </div>
      </div>
      <p className="muted">
        {t('basket.store', { store: name(basket.store.name) })} · {t('basket.single_store')}
        {basket.compared > 1 ? ` ${t('basket.compared', { n: basket.compared })}` : ''}
      </p>
      <ErrorBox error={error} />
      {priceError && <Alert tone="warn">{t('error.network')}</Alert>}
      <div className="layout-2">
        <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
          <Recovery />
          {!shown ? (
            <SkeletonList n={5} />
          ) : (
            <BasketEditor priced={shown} constraints={form} onQty={setQty} onReplace={replaceItem} />
          )}
          <WhyPanel facts={basket.facts} health={basket.health} priced={priced} />
        </div>
        <aside className="stack">
          {priced ? (
            <BudgetSummary
              totals={priced.totals}
              budget={priced.budget}
              pricing={pricing}
              store={name(basket.store.name)}
            />
          ) : (
            <SkeletonList n={1} />
          )}
          <Card className="stack">
            <Button
              block
              onClick={() => nav('/checkout')}
              disabled={!priced || priced.totals.belowMinOrder || priced.lines.length === 0}
            >
              {t('basket.checkout')}
            </Button>
            <Button block variant="secondary" onClick={save} busy={saving}>
              {t('basket.save')}
            </Button>
            <Button block variant="ghost" onClick={ask} busy={asking}>
              {t('basket.share')}
            </Button>
          </Card>
        </aside>
      </div>
      {priced && (
        <div className="minibar" role="region" aria-label={t('basket.total')}>
          <div>
            <div className="small muted">{t('basket.mini_total')}</div>
            <div className="strong">
              <Money minor={priced.totals.totalMinor} />
            </div>
          </div>
          <Badge
            tone={
              priced.budget.state === 'within'
                ? 'ok'
                : priced.budget.state === 'close'
                  ? 'warn'
                  : priced.budget.state === 'over'
                    ? 'bad'
                    : 'info'
            }
          >
            {t(`budget.${priced.budget.state}` as Key)}
          </Badge>
          <Button
            size="small"
            onClick={() => nav('/checkout')}
            disabled={priced.totals.belowMinOrder || priced.lines.length === 0}
          >
            {t('basket.checkout')}
          </Button>
        </div>
      )}
    </div>
  );
}
