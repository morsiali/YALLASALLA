import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import { useCategories } from '../../lib/facts';
import type { Line } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chips,
  ErrorBox,
  Money,
  SkeletonList,
  toast,
  useLoad,
} from '../../components/ui';
import { AvailabilityBadge } from '../../components/basket';
import { StoreCard } from './Home';

export function StoresPage() {
  const { t } = useI18n();
  const { form } = useApp();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useLoad(
    () =>
      api<any[]>(
        `/stores?${new URLSearchParams({ ...(form.areaId ? { areaId: form.areaId } : {}), ...(q ? { q } : {}) })}`,
      ),
    [form.areaId, q],
  );
  return (
    <div className="stack">
      <h1>{t('stores.title')}</h1>
      <input
        className="input"
        type="search"
        placeholder={t('stores.search')}
        aria-label={t('stores.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading ? (
        <SkeletonList n={2} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Alert tone="info">{t('home.stores.empty')}</Alert>
      ) : (
        <div className="grid cols-2">
          {data.map((s) => (
            <StoreCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StorePage() {
  const { id } = useParams();
  const { t, name, money, locale } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const { addItem, basket, setBasket } = useApp();
  const cats = useCategories();
  const [category, setCategory] = useState('');
  const [diet, setDiet] = useState<string[]>([]);
  const [inStock, setInStock] = useState(false);
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<{ items: Line[]; next: string | null }[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const store = useLoad(() => api<any>(`/stores/${id}`), [id]);
  const qs = (cursor?: string) =>
    new URLSearchParams({
      limit: '24',
      ...(category ? { category } : {}),
      ...(diet.length ? { diet: diet.join(',') } : {}),
      ...(inStock ? { inStock: '1' } : {}),
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
    });
  const first = useLoad(async () => {
    const r = await api<any>(`/stores/${id}/products?${qs()}`);
    setPages([{ items: r.items, next: r.nextCursor }]);
    return r;
  }, [id, category, diet.join(','), inStock, q]);
  const more = async () => {
    const last = pages[pages.length - 1];
    if (!last?.next) return;
    setLoadingMore(true);
    try {
      const r = await api<any>(`/stores/${id}/products?${qs(last.next)}`);
      setPages([...pages, { items: r.items, next: r.nextCursor }]);
    } finally {
      setLoadingMore(false);
    }
  };
  const s = store.data;
  if (store.loading) return <SkeletonList n={3} />;
  if (store.error || !s) return <ErrorBox error={store.error} onRetry={store.reload} />;
  const items = pages.flatMap((p) => p.items);
  const add = (l: Line) => {
    if (!basket)
      setBasket({
        storeId: s.id,
        generationId: null,
        source: 'guided',
        store: {
          id: s.id,
          name: { en: s.name_en, ar: s.name_ar },
          deliveryFeeMinor: s.delivery_fee_minor,
          freeDeliveryOverMinor: s.free_delivery_over_minor,
          minOrderMinor: s.min_order_minor,
        },
        items: [{ productId: l.productId, qty: 1 }],
        original: [],
        facts: [],
        health: null,
        compared: 1,
        recovery: [],
      });
    else if (basket.storeId !== s.id) {
      if (!window.confirm(t('basket.single_store'))) return;
      setBasket({
        ...basket,
        storeId: s.id,
        generationId: null,
        store: {
          id: s.id,
          name: { en: s.name_en, ar: s.name_ar },
          deliveryFeeMinor: s.delivery_fee_minor,
          freeDeliveryOverMinor: s.free_delivery_over_minor,
          minOrderMinor: s.min_order_minor,
        },
        items: [{ productId: l.productId, qty: 1 }],
        facts: [],
        health: null,
      });
    } else addItem(l.productId);
    toast(t('item.added'));
  };
  const message = async (ref?: { type: string; id: string }) => {
    if (!user) {
      nav(`/signin?next=/stores/${s.id}`);
      return;
    }
    try {
      const c = await api('/conversations', { body: { storeId: s.id, ...(ref ? { ref } : {}) } });
      nav(`/messages/${c.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const save = async () => {
    if (!user) {
      nav(`/signin?next=/stores/${s.id}`);
      return;
    }
    await api('/saved', { body: { kind: 'store', refId: s.id } });
    toast(t('stores.saved'));
  };
  return (
    <div className="stack">
      <img
        src={s.cover_image ?? '/img/store-cover.svg'}
        alt=""
        style={{ borderRadius: 16, width: '100%', maxHeight: 180, objectFit: 'cover' }}
      />
      <div className="row between">
        <h1 style={{ margin: 0 }}>{name(s)}</h1>
        {s.open_now ? (
          <Badge tone="ok">{t('stores.open_now')}</Badge>
        ) : (
          <Badge tone="warn">{t('stores.closed_now')}</Badge>
        )}
      </div>
      <p className="muted">{name({ en: s.description_en ?? '', ar: s.description_ar ?? '' })}</p>
      <Card className="small stack">
        <div>
          {t('stores.hours', { open: s.opening_hours.open, close: s.opening_hours.close })} ·{' '}
          {t('stores.delivery', { fee: money(s.delivery_fee_minor) })}
          {s.free_delivery_over_minor
            ? ` (${t('stores.free_over', { amount: money(s.free_delivery_over_minor) })})`
            : ''}{' '}
          · {t('stores.min', { amount: money(s.min_order_minor) })}
        </div>
        <div>
          {t('stores.eta', { min: s.eta_min_minutes, max: s.eta_max_minutes })} — {t('stores.eta_note')}
          {s.accepts_cod ? ` · ${t('stores.cod')}` : ''}
        </div>
        <div>{t('ready.areas', { areas: (s.areas as any[]).map((a) => name(a)).join(' · ') })}</div>
        <div className="row">
          <Button size="small" onClick={() => message({ type: 'store', id: s.id })}>
            💬 {t('stores.message')}
          </Button>
          <Button size="small" variant="secondary" onClick={save}>
            {t('stores.save')}
          </Button>
          <Link className="btn small ghost" to="/basket">
            {t('nav.basket')}
          </Link>
        </div>
      </Card>
      <div className="stack">
        <input
          className="input"
          type="search"
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Chips
          value={category || 'all'}
          onChange={(v: string) => setCategory(v === 'all' ? '' : v)}
          label={t('stores.filter.category')}
          options={[
            { value: 'all', label: t('common.all') },
            ...(s.categories as any[]).map((c) => ({
              value: c.code,
              label: locale === 'ar' ? c.name_ar : c.name_en,
            })),
          ]}
        />
        <div className="row">
          <Chips
            multi
            value={diet}
            onChange={setDiet}
            label={t('stores.filter.diet')}
            options={['halal', 'vegetarian', 'gluten_free', 'organic'].map((d) => ({
              value: d,
              label: t(`diet.${d}` as Key),
            }))}
          />
          <label className="row">
            <input
              type="checkbox"
              checked={inStock}
              onChange={(e) => setInStock(e.target.checked)}
              style={{ width: 22, height: 22 }}
            />{' '}
            {t('stores.filter.instock')}
          </label>
        </div>
      </div>
      {first.loading ? (
        <SkeletonList n={4} />
      ) : first.error ? (
        <ErrorBox error={first.error} onRetry={first.reload} />
      ) : !items.length ? (
        <Alert tone="info">{t('stores.no_products')}</Alert>
      ) : (
        <>
          <div className="grid cols-3">
            {items.map((l) => (
              <Card key={l.productId} className="stack">
                <div className="row">
                  <img
                    className="thumb"
                    src={l.imageUrl ?? ''}
                    alt=""
                    loading="lazy"
                    width={64}
                    height={64}
                  />
                  <div className="grow">
                    <Link to={`/products/${l.productId}`} className="strong">
                      {name(l.name)}
                    </Link>
                    <div className="small muted">
                      {l.brand} · {l.sizeLabel}
                    </div>
                    <div className="small muted">
                      {cats[l.categoryCode]
                        ? name({ en: cats[l.categoryCode].name_en, ar: cats[l.categoryCode].name_ar })
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="row between">
                  <div>
                    <Money minor={l.unitPriceMinor} />
                    {l.compareAtMinor ? (
                      <>
                        {' '}
                        <span className="price-was">
                          <Money minor={l.compareAtMinor} />
                        </span>
                      </>
                    ) : null}
                  </div>
                  <AvailabilityBadge a={l.availability} />
                </div>
                <div className="row">
                  {l.dietary.slice(0, 3).map((d) => (
                    <Badge key={d} tone="info" icon="•">
                      {t(`diet.${d}` as Key)}
                    </Badge>
                  ))}
                </div>
                <div className="row">
                  <Button size="small" disabled={l.availability === 'unavailable'} onClick={() => add(l)}>
                    {t('item.add')}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => message({ type: 'product', id: l.productId })}
                  >
                    {t('item.ask_store')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {pages[pages.length - 1]?.next && (
            <div style={{ textAlign: 'center' }}>
              <Button variant="secondary" onClick={more} busy={loadingMore}>
                {t('common.more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProductPage() {
  const { id } = useParams();
  const { t, name } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const { addItem, basket } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>(`/products/${id}`), [id]);
  if (loading) return <SkeletonList n={2} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const p = data;
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <Link to={`/stores/${p.storeId}`}>← {t('common.back')}</Link>
      <div className="row">
        <img src={p.imageUrl ?? ''} alt="" width={120} height={120} style={{ borderRadius: 16 }} />
        <div>
          <h1 style={{ margin: 0 }}>{name(p.name)}</h1>
          <div className="muted">
            {p.brand} · {p.sizeLabel}
          </div>
          <div className="strong">
            <Money minor={p.unitPriceMinor} />
          </div>
          <AvailabilityBadge a={p.availability} />
        </div>
      </div>
      <p>{name(p.description ?? { en: '', ar: '' })}</p>
      <div className="row">
        {p.dietary.map((d: string) => (
          <Badge key={d} tone="info" icon="•">
            {t(`diet.${d}` as Key)}
          </Badge>
        ))}
        {p.allergens.map((a: string) => (
          <Badge key={a} tone="warn">
            {t(`allergen.${a}` as Key)}
          </Badge>
        ))}
      </div>
      {p.countryOfOrigin && (
        <div className="small muted">
          {t('item.origin')}: {p.countryOfOrigin}
        </div>
      )}
      <div className="row">
        <Button
          onClick={() => {
            if (basket && basket.storeId === p.storeId) {
              addItem(p.productId);
              nav('/basket');
            } else nav(`/stores/${p.storeId}`);
          }}
          disabled={p.availability === 'unavailable'}
        >
          {t('item.add')}
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            if (!user) {
              nav(`/signin?next=/products/${p.productId}`);
              return;
            }
            await api('/saved', { body: { kind: 'product', refId: p.productId } });
            toast(t('stores.saved'));
          }}
        >
          {t('item.save_item')}
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (!user) {
              nav(`/signin?next=/products/${p.productId}`);
              return;
            }
            const c = await api('/conversations', {
              body: { storeId: p.storeId, ref: { type: 'product', id: p.productId } },
            });
            nav(`/messages/${c.id}`);
          }}
        >
          {t('item.ask_store')}
        </Button>
      </div>
    </div>
  );
}
