import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../state/app';
import { useI18n } from '../../i18n';
import type { Line, Totals, BudgetStatus } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Segmented,
  Skeleton,
  Stepper,
  useLoad,
  Money,
} from '../../components/ui';
import { BudgetSummary, LineRow } from '../../components/basket';
import type { Key } from '../../i18n/en';

export function StoreCard({ s }: { s: any }) {
  const { t, name, money } = useI18n();
  return (
    <Card className="stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{name(s)}</h3>
        {s.open_now ? (
          <Badge tone="ok">{t('stores.open_now')}</Badge>
        ) : (
          <Badge tone="warn">{t('stores.closed_now')}</Badge>
        )}
      </div>
      <p className="muted small">{locale_desc(s, name)}</p>
      <div className="small">
        {t('stores.delivery', { fee: money(s.delivery_fee_minor) })}
        {s.free_delivery_over_minor
          ? ` · ${t('stores.free_over', { amount: money(s.free_delivery_over_minor) })}`
          : ''}
        <br />
        {t('stores.min', { amount: money(s.min_order_minor) })}
        <br />
        {t('stores.eta', { min: s.eta_min_minutes, max: s.eta_max_minutes })}{' '}
        <span className="muted">({t('stores.eta_note')})</span>
      </div>
      <Link className="btn secondary small" to={`/stores/${s.id}`}>
        {t('stores.catalog')}
      </Link>
    </Card>
  );
}
const locale_desc = (s: any, name: (o: any) => string) =>
  name({ en: s.description_en ?? '', ar: s.description_ar ?? '' });

export function ReadyCard({ r }: { r: any }) {
  const { t, name, people, days } = useI18n();
  const type = r.basket_type as string;
  return (
    <Card className="stack">
      <h3 style={{ margin: 0 }}>{t(`ready.type.${type}` as Key)}</h3>
      <p className="muted small">{name({ en: r.description_en, ar: r.description_ar })}</p>
      <div className="small">
        <strong>
          {t('ready.assumes', { household: people(r.household_size), days: days(r.duration_days) })}
        </strong>
        <br />
        {t('ready.store', { store: name({ en: r.store_name_en, ar: r.store_name_ar }) })}
        <br />
        {t('ready.areas', { areas: (r.areas as any[]).map((a) => name(a)).join(' · ') })}
      </div>
      <div className="row between">
        <div>
          <div className="small muted">{t('ready.from')}</div>
          <div className="strong">
            <Money minor={r.items_total_minor} />
          </div>
        </div>
        {r.unavailable_count > 0 && (
          <Badge tone="warn">{t('ready.unavailable', { n: r.unavailable_count })}</Badge>
        )}
      </div>
      <Link className="btn secondary" to={`/ready/${r.id}`}>
        {t('ready.customize')}
      </Link>
    </Card>
  );
}

function ExampleBasket() {
  const { t, locale, name } = useI18n();
  const { areas } = useApp();
  const [res, setRes] = useState<{ lines: Line[]; totals: Totals; budget: BudgetStatus; store: any } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    const a = areas.find((x) => x.served && x.name_en.includes('Marina')) ?? areas.find((x) => x.served);
    if (!a) return;
    setBusy(true);
    setError(null);
    try {
      setRes(
        await api('/baskets/generate', {
          body: {
            constraints: {
              areaId: a.id,
              household: 4,
              days: 7,
              budgetMinor: 50000,
              budgetIncludesDelivery: true,
              diet: ['halal'],
            },
            budgetScopeConfirmed: true,
          },
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section" aria-labelledby="ex-h">
      <h2 id="ex-h">{t('home.example.title')}</h2>
      <p className="muted">{t('home.example.sub')}</p>
      {!res ? (
        <Button variant="secondary" onClick={run} busy={busy}>
          {t('home.example.cta')}
        </Button>
      ) : (
        <div className="layout-2">
          <Card>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {name(res.store.name)} · {locale === 'ar' ? 'أول 5 منتجات' : 'First 5 items'}
            </div>
            {res.lines.slice(0, 5).map((l) => (
              <LineRow key={l.productId} line={l} readonly />
            ))}
          </Card>
          <aside>
            <BudgetSummary totals={res.totals} budget={res.budget} store={name(res.store.name)} />
          </aside>
        </div>
      )}
      <ErrorBox error={error} />
    </section>
  );
}

export default function Home() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { area, form, setForm, setAreaPickerOpen, config } = useApp();
  const ready = useLoad(
    () => api<any[]>(`/ready-baskets${form.areaId ? `?areaId=${form.areaId}` : ''}`),
    [form.areaId],
  );
  const stores = useLoad(
    () => api<any[]>(`/stores${form.areaId ? `?areaId=${form.areaId}` : ''}`),
    [form.areaId],
  );
  const { name } = useI18n();
  const faq = [1, 2, 3, 4, 5, 6] as const;
  return (
    <div>
      <section className="hero" aria-labelledby="hero-h">
        <div className="stack">
          <h1 id="hero-h">{t('brand.tagline')}</h1>
          <p className="lead">{t('brand.sub')}</p>
          <div className="row">
            <Link className="btn" to="/build">
              {t('cta.build')}
            </Link>
            <Link className="btn secondary" to="/ready">
              {t('cta.explore')}
            </Link>
          </div>
        </div>
        <Card className="stack" aria-label={t('builder.title')}>
          <div className="row between">
            <strong>{t('builder.title')}</strong>
            <button className="pill" onClick={() => setAreaPickerOpen(true)}>
              📍 {area ? name(area) : t('area.choose')}
            </button>
          </div>
          <div className="row between">
            <span className="label">{t('builder.household')}</span>
            <Stepper
              value={form.household}
              min={1}
              max={12}
              onChange={(v) => setForm((f) => ({ ...f, household: v }))}
              label={t('builder.household')}
            />
          </div>
          <div className="row between">
            <span className="label">{t('builder.days')}</span>
            <Segmented
              value={String(form.days)}
              onChange={(v) => setForm((f) => ({ ...f, days: Number(v) }))}
              label={t('builder.days')}
              options={[
                { value: '7', label: t('builder.days.7') },
                { value: '14', label: t('builder.days.14') },
                { value: '30', label: t('builder.days.30') },
              ]}
            />
          </div>
          <Button onClick={() => nav('/build')}>{t('cta.build')}</Button>
          <Link to="/build?mode=natural" className="small">
            {t('builder.tab.natural')} →
          </Link>
        </Card>
      </section>

      <section className="section" aria-labelledby="how-h">
        <h2 id="how-h">{t('home.how.title')}</h2>
        <div className="steps">
          {[1, 2, 3].map((n) => (
            <div className="step" key={n}>
              <h3>{t(`home.how.${n}.t` as Key)}</h3>
              <p className="muted">{t(`home.how.${n}.d` as Key)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="rb-h">
        <div className="row between">
          <h2 id="rb-h">{t('home.ready.title')}</h2>
          <Link to="/ready">{t('common.view')} →</Link>
        </div>
        <p className="muted">{t('home.ready.sub')}</p>
        {ready.loading ? (
          <div className="grid cols-3">
            <Skeleton h={180} />
            <Skeleton h={180} />
            <Skeleton h={180} />
          </div>
        ) : ready.error ? (
          <ErrorBox error={ready.error} onRetry={ready.reload} />
        ) : (
          <div className="grid cols-3">
            {(ready.data ?? []).slice(0, 3).map((r) => (
              <ReadyCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="st-h">
        <h2 id="st-h">{t('home.stores.title', { area: area ? name(area) : '' })}</h2>
        {stores.loading ? (
          <Skeleton h={140} />
        ) : !(stores.data ?? []).length ? (
          <Card>{t('home.stores.empty')}</Card>
        ) : (
          <div className="grid cols-2">
            {stores.data!.map((s) => (
              <StoreCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      <section className="section card" aria-labelledby="intel-h">
        <h2 id="intel-h">{t('home.intel.title')}</h2>
        <ul className="facts">
          {[1, 2, 3, 4].map((n) => (
            <li key={n}>{t(`home.intel.${n}` as Key)}</li>
          ))}
        </ul>
      </section>

      <ExampleBasket />

      <section className="section" aria-labelledby="re-h">
        <h2 id="re-h">{t('home.reassure.title')}</h2>
        <ul className="facts">
          {[1, 2, 3].map((n) => (
            <li key={n}>{t(`home.reassure.${n}` as Key)}</li>
          ))}
        </ul>
      </section>
      <section className="section card" aria-labelledby="rp-h">
        <h2 id="rp-h">{t('home.repeat.title')}</h2>
        <p>{t('home.repeat.sub')}</p>
        <Link to="/loyalty">{t('nav.loyalty')} →</Link>
      </section>
      <section className="section" aria-labelledby="tr-h">
        <h2 id="tr-h">{t('home.trust.title')}</h2>
        <ul className="facts">
          {[1, 2, 3, 4].map((n) => (
            <li key={n}>{t(`home.trust.${n}` as Key)}</li>
          ))}
        </ul>
        {config && (
          <p className="small muted">
            {t(`mode.otp.${config.providers.otp.mode}` as Key)} ·{' '}
            {t(`mode.payments.${config.providers.payments.mode}` as Key)} ·{' '}
            {t(`mode.transcription.${config.providers.transcription.mode}` as Key)} ·{' '}
            {t(`mode.ai.${config.providers.ai.name}` as Key)}
          </p>
        )}
      </section>
      <section className="section faq" aria-labelledby="faq-h">
        <h2 id="faq-h">{t('faq.title')}</h2>
        {faq.map((n) => (
          <details key={n}>
            <summary>{t(`faq.q${n}` as Key)}</summary>
            <p>{t(`faq.a${n}` as Key)}</p>
          </details>
        ))}
      </section>
      <section className="section hero" style={{ textAlign: 'center' }}>
        <h2>{t('home.final.title')}</h2>
        <div>
          <Link className="btn" to="/build">
            {t('cta.build')}
          </Link>
        </div>
      </section>
    </div>
  );
}
