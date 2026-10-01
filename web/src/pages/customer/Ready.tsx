import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import { Alert, Button, Card, ErrorBox, SkeletonList, useLoad } from '../../components/ui';
import { LineRow } from '../../components/basket';
import { ReadyCard } from './Home';
import { generateBasket } from './Builder';

export function ReadyList() {
  const { t, name } = useI18n();
  const { form, area, setAreaPickerOpen } = useApp();
  const { data, loading, error, reload } = useLoad(
    () => api<any[]>(`/ready-baskets${form.areaId ? `?areaId=${form.areaId}` : ''}`),
    [form.areaId],
  );
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('ready.title')}</h1>
        <button className="pill" onClick={() => setAreaPickerOpen(true)}>
          📍 {area ? name(area) : t('area.choose')}
        </button>
      </div>
      <p className="muted">
        {t('ready.sub')} {t('ready.not_one_size')}
      </p>
      {loading ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>{t('ready.empty')}</Card>
      ) : (
        <div className="grid cols-3">
          {data.map((r) => (
            <ReadyCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ReadyDetail() {
  const { id } = useParams();
  const { t, name, people, days } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const { setBasket, form } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>(`/ready-baskets/${id}`), [id]);
  const [err2, setErr2] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <SkeletonList n={4} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const use = () => {
    const items = data.lines.map((l: any) => ({ productId: l.productId, qty: l.qty }));
    setBasket({
      storeId: data.storeId,
      generationId: null,
      source: 'ready',
      store: data.store,
      items,
      original: items,
      facts: [{ code: 'planned_for', params: { household: data.householdSize, days: data.durationDays } }],
      health: null,
      compared: 1,
      recovery: [],
    });
    nav('/basket');
  };
  // "customize" = rebuild the same basket type for the customer's own household size / days / budget
  const rebuild = async () => {
    if (!form.areaId) {
      nav('/build');
      return;
    }
    setBusy(true);
    setErr2(null);
    try {
      await generateBasket(
        { ...form, basketType: data.basketType, storeId: data.storeId },
        'guided',
        false,
        setBasket,
      );
      nav('/basket');
    } catch (e) {
      setErr2(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <h1>{t(`ready.type.${data.basketType}` as Key)}</h1>
      <p className="muted">{name(data.description)}</p>
      <Alert tone="info">
        {t('ready.assumes', { household: people(data.householdSize), days: days(data.durationDays) })} ·{' '}
        {t('ready.store', { store: name(data.store.name) })}. {t('ready.not_one_size')}
      </Alert>
      <ErrorBox error={err2} />
      <div className="row">
        <Button onClick={use}>{t('ready.use')}</Button>
        <Button variant="secondary" onClick={rebuild} busy={busy}>
          {t('builder.household')} / {t('builder.days')}…
        </Button>
        {!user && null}
      </div>
      <Card>
        {data.lines.map((l: any) => (
          <LineRow key={l.productId} line={{ ...l, reason: 'planned', priority: 'manual' }} readonly />
        ))}
      </Card>
    </div>
  );
}
