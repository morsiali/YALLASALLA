import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chips,
  ErrorBox,
  Field,
  Modal,
  Money,
  SkeletonList,
  TextInput,
  toast,
  useLoad,
} from '../../components/ui';
import { Timeline, statusTone } from '../customer/Orders';

interface Biz {
  id: string;
  name_en: string;
  name_ar: string;
  status: string;
  review_note: string | null;
  member_role: 'owner' | 'staff';
  permissions: string[];
  stores: any[];
  package: { code: string | null; name_en?: string; name_ar?: string; entitlements: any };
  usage: { products: number; ready_baskets: number; staff: number; stores: number };
}
const useBiz = () => useLoad(() => api<{ businesses: Biz[] }>('/merchant/me'), []);
const can = (b: Biz, p: string) => b.member_role === 'owner' || b.permissions.includes(p);

export function MerchantLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useBiz();
  useEffect(() => {
    if (user && user.role !== 'merchant') nav('/');
  }, [user, nav]);
  if (loading && !data) return <SkeletonList n={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const b = data?.businesses[0];
  if (!b) return <Onboarding onDone={reload} />;
  const links: [string, Key, boolean][] = [
    ['/business', 'm.dashboard', true],
    ['/business/orders', 'm.orders', can(b, 'orders')],
    ['/business/catalog', 'm.catalog', can(b, 'catalog')],
    ['/business/ready', 'm.ready', can(b, 'catalog')],
    ['/business/messages', 'm.messages', can(b, 'conversations')],
    ['/business/reports', 'm.reports', can(b, 'reports')],
    ['/business/staff', 'm.staff', b.member_role === 'owner'],
    ['/business/package', 'm.package', b.member_role === 'owner'],
    ['/business/store', 'm.store', b.member_role === 'owner'],
  ];
  return (
    <div className="layout-sidebar">
      <nav className="side" aria-label={t('m.title')}>
        {links
          .filter((l) => l[2])
          .map(([to, k]) => (
            <NavLink key={to} to={to} end={to === '/business'}>
              {t(k)}
            </NavLink>
          ))}
      </nav>
      <div className="stack">
        <Outlet context={{ b, reload }} />
      </div>
    </div>
  );
}
import { useOutletContext } from 'react-router-dom';
const useCtx = () => useOutletContext<{ b: Biz; reload: () => void }>();

function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, name, money, days } = useI18n();
  const { areas } = useApp();
  const pk = useLoad(() => api<any[]>('/packages'), []);
  const [f, setF] = useState({
    nameEn: '',
    nameAr: '',
    lic: '',
    phone: '',
    storeEn: '',
    storeAr: '',
    fee: '10',
    free: '',
    min: '0',
    pkg: 'starter',
    areaIds: [] as string[],
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/merchant/onboard', {
        body: {
          nameEn: f.nameEn,
          nameAr: f.nameAr,
          tradeLicenseNo: f.lic,
          contactPhone: f.phone,
          packageCode: f.pkg,
          store: {
            nameEn: f.storeEn || f.nameEn,
            nameAr: f.storeAr || f.nameAr,
            deliveryFeeMinor: Math.round(parseFloat(f.fee || '0') * 100),
            freeDeliveryOverMinor: f.free ? Math.round(parseFloat(f.free) * 100) : null,
            minOrderMinor: Math.round(parseFloat(f.min || '0') * 100),
            areaIds: f.areaIds,
          },
        },
      });
      onDone();
    } catch (er) {
      setError(er);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 720, marginInline: 'auto' }}>
      <h1>{t('m.onboard.title')}</h1>
      <p className="muted">{t('m.onboard.sub')}</p>
      <ErrorBox error={error} />
      <Card className="stack">
        <h2>{t('m.onboard.business')}</h2>
        <TextInput
          label={t('m.onboard.name_en')}
          value={f.nameEn}
          onChange={(v) => set('nameEn', v)}
          required
        />
        <TextInput
          label={t('m.onboard.name_ar')}
          value={f.nameAr}
          onChange={(v) => set('nameAr', v)}
          required
          dir="rtl"
        />
        <TextInput
          label={t('m.onboard.license')}
          value={f.lic}
          onChange={(v) => set('lic', v)}
          required
          dir="ltr"
        />
        <TextInput
          label={t('m.onboard.contact')}
          value={f.phone}
          onChange={(v) => set('phone', v)}
          required
          dir="ltr"
        />
      </Card>
      <Card className="stack">
        <h2>{t('m.onboard.store')}</h2>
        <TextInput label={t('m.onboard.store_en')} value={f.storeEn} onChange={(v) => set('storeEn', v)} />
        <TextInput
          label={t('m.onboard.store_ar')}
          value={f.storeAr}
          onChange={(v) => set('storeAr', v)}
          dir="rtl"
        />
        <div className="field">
          <span className="label">{t('m.onboard.areas')}</span>
          <Chips
            multi
            value={f.areaIds}
            onChange={(v: string[]) => set('areaIds', v)}
            options={areas.map((a) => ({ value: a.id, label: name(a) }))}
          />
        </div>
        <div className="grid cols-3">
          <TextInput
            label={t('m.onboard.fee')}
            value={f.fee}
            onChange={(v) => set('fee', v)}
            inputMode="decimal"
          />
          <TextInput
            label={t('m.onboard.free_over')}
            value={f.free}
            onChange={(v) => set('free', v)}
            inputMode="decimal"
          />
          <TextInput
            label={t('m.onboard.min')}
            value={f.min}
            onChange={(v) => set('min', v)}
            inputMode="decimal"
          />
        </div>
      </Card>
      <Card className="stack">
        <h2>{t('m.onboard.package')}</h2>
        <div className="grid cols-2">
          {(pk.data ?? []).map((p) => (
            <label
              key={p.code}
              className="card flat stack"
              style={{ cursor: 'pointer', borderColor: f.pkg === p.code ? 'var(--brand)' : undefined }}
            >
              <span className="row">
                <input
                  type="radio"
                  name="pkg"
                  checked={f.pkg === p.code}
                  onChange={() => set('pkg', p.code)}
                  style={{ width: 22, height: 22 }}
                />
                <strong>{name({ en: p.name_en, ar: p.name_ar })}</strong>
              </span>
              <span>
                {t('m.pkg.price', {
                  amount: money(p.price_minor),
                  interval: t(`m.pkg.${p.billing_interval}` as Key),
                })}
                {p.trial_days ? ` · ${t('m.pkg.trial', { days: days(p.trial_days) })}` : ''}
              </span>
              <PackageLimits e={p.entitlements} />
            </label>
          ))}
        </div>
      </Card>
      <Button type="submit" busy={busy} disabled={f.areaIds.length === 0}>
        {t('m.onboard.submit')}
      </Button>
    </form>
  );
}
export function PackageLimits({ e }: { e: any }) {
  const { t } = useI18n();
  return (
    <ul className="small facts">
      <li>{t('m.pkg.products', { n: e.max_products })}</li>
      <li>{t('m.pkg.ready', { n: e.max_ready_baskets })}</li>
      <li>{t('m.pkg.staff', { n: e.staff_seats })}</li>
      <li>{t('m.pkg.messages', { n: e.messages_per_day })}</li>
      <li>{t('m.pkg.analytics', { level: e.analytics })}</li>
    </ul>
  );
}

export function MDashboard() {
  const { t, name } = useI18n();
  const { b } = useCtx();
  const { tick } = useAuth();
  const orders = useLoad(
    () => (can(b, 'orders') ? api<any[]>('/merchant/orders?limit=100') : Promise.resolve([])),
    [tick],
  );
  const o = orders.data ?? [];
  return (
    <div className="stack">
      <h1>{name({ en: b.name_en, ar: b.name_ar })}</h1>
      <Alert
        tone={b.status === 'approved' ? 'ok' : b.status === 'pending' ? 'info' : 'bad'}
        title={t(`m.status.${b.status}` as Key)}
      >
        {b.status === 'pending'
          ? t('m.onboard.pending')
          : b.review_note
            ? t('m.review_note', { note: b.review_note })
            : null}
      </Alert>
      <div className="kpis">
        <Card>
          <div className="small muted">{t('m.kpi.orders_new')}</div>
          <div className="kpi num">{o.filter((x) => x.status === 'received').length}</div>
        </Card>
        <Card>
          <div className="small muted">{t('m.kpi.pending_sub')}</div>
          <div className="kpi num">{o.filter((x) => x.has_pending_substitution).length}</div>
        </Card>
        <Card>
          <div className="small muted">{t('m.pkg.current')}</div>
          <div className="strong">{b.package.code ?? '—'}</div>
          <div className="small muted">
            {t('m.pkg.usage', {
              products: b.usage.products,
              ready: b.usage.ready_baskets,
              staff: b.usage.staff,
            })}
          </div>
        </Card>
      </div>
      {can(b, 'orders') && (
        <Link className="btn" to="/business/orders">
          {t('m.orders')}
        </Link>
      )}
    </div>
  );
}

const COLS: [string, string[]][] = [
  ['m.orders.filter.new', ['received']],
  ['m.orders.filter.active', ['reviewing', 'preparing', 'ready', 'out_for_delivery']],
  ['m.orders.filter.done', ['delivered', 'cancelled', 'rejected']],
];
export function MOrders() {
  const { t, date } = useI18n();
  const { tick } = useAuth();
  const [tab, setTab] = useState(0);
  const { data, loading, error, reload } = useLoad(
    () => api<any[]>(`/merchant/orders?status=${COLS[tab][1].join(',')}`),
    [tab, tick],
  );
  return (
    <div className="stack">
      <h1>{t('m.orders.queue')}</h1>
      <Chips
        value={String(tab)}
        onChange={(v: string) => setTab(Number(v))}
        options={COLS.map(([k], i) => ({ value: String(i), label: t(k as Key) }))}
      />
      {loading && !data ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>{t('m.orders.empty')}</Card>
      ) : (
        data.map((o) => (
          <Link
            key={o.id}
            to={`/business/orders/${o.id}`}
            className="card row between"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div>
              <div className="strong">
                {t('order.title', { no: o.order_no })} · {o.customer_name}
              </div>
              <div className="small muted">
                {date(o.placed_at)} · {t('basket.lines', { n: o.item_count })}
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <Money minor={o.total_minor} />
              <div>
                <Badge tone={statusTone(o.status)}>{t(`status.${o.status}` as Key)}</Badge>
              </div>
              {o.has_pending_substitution && <Badge tone="warn">{t('m.orders.pending_sub')}</Badge>}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

const NEXT: Record<string, string> = {
  received: 'reviewing',
  reviewing: 'preparing',
  preparing: 'ready',
  ready: 'out_for_delivery',
  out_for_delivery: 'delivered',
};
export function MOrderDetail() {
  const { id = '' } = useParams();
  const { t, name, date } = useI18n();
  const { tick } = useAuth();
  const { b } = useCtx();
  const { areas } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>(`/merchant/orders/${id}`), [id, tick]);
  const [unavail, setUnavail] = useState<any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <SkeletonList n={4} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { order: o, items, history, substitutions } = data;
  const area = areas.find((a) => a.id === o.address.areaId);
  const move = async (to: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/merchant/orders/${id}/status`, { body: { to } });
      await reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const next = NEXT[o.status];
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('order.title', { no: o.order_no })}</h1>
        <Badge tone={statusTone(o.status)}>{t(`status.${o.status}` as Key)}</Badge>
      </div>
      <ErrorBox error={err} />
      <div className="layout-2">
        <div className="stack">
          <Card>
            <h2>{t('order.items')}</h2>
            {(items as any[]).map((i) => (
              <div
                key={i.id}
                className="row between"
                style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}
              >
                <div>
                  <div className="strong">
                    {name({ en: i.name_en, ar: i.name_ar })} × {i.qty}
                  </div>
                  <div className="small muted">
                    {i.brand} · {i.size_label} · <Money minor={i.line_total_minor} />
                  </div>
                  {i.status !== 'ok' && (
                    <Badge tone={i.status === 'substituted' ? 'info' : 'bad'}>
                      {i.status === 'substituted'
                        ? t('item.substituted')
                        : i.status === 'removed'
                          ? t('subst.removed_note')
                          : t('item.unavailable')}
                    </Badge>
                  )}
                </div>
                {i.status === 'ok' && ['reviewing', 'preparing'].includes(o.status) && can(b, 'orders') && (
                  <Button size="small" variant="secondary" onClick={() => setUnavail(i)}>
                    {t('m.orders.mark_unavailable')}
                  </Button>
                )}
              </div>
            ))}
          </Card>
          {substitutions.length > 0 && (
            <Card>
              <h2>{t('subst.title')}</h2>
              {substitutions.map((s: any) => (
                <div key={s.id} className="small">
                  {name({ en: s.orig_name_en, ar: s.orig_name_ar })} →{' '}
                  {s.proposed_name_en
                    ? name({ en: s.proposed_name_en, ar: s.proposed_name_ar })
                    : t('m.orders.no_sub')}{' '}
                  ·{' '}
                  <Badge tone={s.status === 'pending' ? 'warn' : s.status === 'rejected' ? 'bad' : 'ok'}>
                    {t(`subst.status.${s.status}` as Key)}
                  </Badge>
                </div>
              ))}
            </Card>
          )}
          <Card>
            <h2>{t('order.timeline')}</h2>
            <Timeline status={o.status} history={history} />
          </Card>
        </div>
        <aside className="stack">
          <Card className="stack">
            <div>
              <strong>{t('m.orders.customer')}</strong>
              <div>{o.address.contactName}</div>
              <div className="small muted num">{o.address.contactPhone}</div>
            </div>
            <div>
              <strong>{t('m.orders.address')}</strong>
              <div>
                {o.address.building}
                {o.address.unit ? `, ${o.address.unit}` : ''}
                {area ? ` · ${name(area)}` : ''}
              </div>
              {o.address.instructions && <div className="small muted">{o.address.instructions}</div>}
            </div>
            {o.notes && (
              <div>
                <strong>{t('common.notes')}</strong>
                <div>{o.notes}</div>
              </div>
            )}
            <div className="small">
              {t('m.orders.policy', { policy: t(`builder.subst.${o.substitution_policy}` as Key) })} ·{' '}
              {t('order.payment')}: {t(`order.payment.${o.payment_status}` as Key)}
            </div>
            <div className="strong">
              <Money minor={o.total_minor} />
            </div>
            <div className="small muted">{date(o.placed_at)}</div>
          </Card>
          {can(b, 'orders') && !['delivered', 'cancelled', 'rejected'].includes(o.status) && (
            <Card className="stack">
              {next && (
                <Button block busy={busy} onClick={() => move(next)}>
                  {t('m.orders.advance', { status: t(`status.${next}` as Key) })}
                </Button>
              )}
              {['received', 'reviewing'].includes(o.status) && (
                <Button block variant="danger" onClick={() => move('rejected')}>
                  {t('m.orders.reject')}
                </Button>
              )}
              {['preparing', 'ready', 'out_for_delivery'].includes(o.status) && (
                <Button block variant="ghost" onClick={() => move('cancelled')}>
                  {t('common.cancel')}
                </Button>
              )}
            </Card>
          )}
          <Link className="btn ghost block" to="/business/messages">
            {t('m.messages')}
          </Link>
        </aside>
      </div>
      {unavail && (
        <UnavailableModal
          orderId={id}
          item={unavail}
          onClose={() => setUnavail(null)}
          onDone={() => {
            setUnavail(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function UnavailableModal({
  orderId,
  item,
  onClose,
  onDone,
}: {
  orderId: string;
  item: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, name, money } = useI18n();
  const [proposed, setProposed] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { data } = useLoad(
    () => api<{ alternatives: any[] }>(`/products/${item.product_id}/alternatives?qty=${item.qty}`),
    [item.id],
  );
  const send = async () => {
    setError(null);
    try {
      const r = await api(`/merchant/orders/${orderId}/items/${item.id}/unavailable`, {
        body: { proposedProductId: proposed || null, reason: reason || undefined },
      });
      setOutcome(r.outcome);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal title={t('m.orders.mark_unavailable')} onClose={onClose}>
      {outcome ? (
        <>
          <Alert tone="ok">{t(`m.orders.outcome.${outcome}` as Key)}</Alert>
          <Button onClick={onDone}>{t('common.done')}</Button>
        </>
      ) : (
        <>
          <p>
            <strong>{name({ en: item.name_en, ar: item.name_ar })}</strong> × {item.qty}
          </p>
          <Field label={t('m.orders.propose')}>
            {(a) => (
              <select {...a} className="input" value={proposed} onChange={(e) => setProposed(e.target.value)}>
                <option value="">{t('m.orders.no_sub')}</option>
                {(data?.alternatives ?? []).map((a) => (
                  <option key={a.productId} value={a.productId}>
                    {name(a.name)} · {a.brand} · {a.sizeLabel} · {money(a.unitPriceMinor * item.qty)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <TextInput label={t('m.orders.reason')} value={reason} onChange={setReason} />
          <ErrorBox error={error} />
          <Button onClick={send}>{t('m.orders.send')}</Button>
        </>
      )}
    </Modal>
  );
}

const DIETS = ['halal', 'vegetarian', 'gluten_free', 'organic', 'high_protein', 'low_sugar'];
const ALLERGENS = ['nuts', 'dairy', 'gluten', 'eggs', 'soy', 'fish'];
export function MCatalog() {
  const { t, name } = useI18n();
  const { b, reload: reloadBiz } = useCtx();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useLoad(
    () => api<any>(`/merchant/products?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    [q],
  );
  const [edit, setEdit] = useState<any | null>(null);
  const [alts, setAlts] = useState<any | null>(null);
  const cats = useLoad(() => api<any[]>('/categories'), []);
  const quick = async (id: string, body: object) => {
    try {
      await api(`/merchant/products/${id}/stock`, { method: 'PATCH', body });
      toast(t('m.product.saved'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('error.generic'));
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('m.catalog')}</h1>
        <Button onClick={() => setEdit({})}>＋ {t('m.product.new')}</Button>
      </div>
      {data && (
        <p className="small muted">
          {t('m.product.usage', { used: data.usage.products, max: data.package.entitlements.max_products })}
        </p>
      )}
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('common.search')}
        aria-label={t('common.search')}
      />
      {loading && !data ? (
        <SkeletonList n={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('m.product.sku')}</th>
                <th>{t('m.product.price')}</th>
                <th>{t('m.product.stock')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((p: any) => (
                <tr key={p.id}>
                  <td>
                    <strong>{name({ en: p.name_en, ar: p.name_ar })}</strong>
                    <div className="small muted">
                      {p.brand} · {p.size_label}
                      {!p.active ? ' · ⛔' : ''}
                    </div>
                  </td>
                  <td className="num">{p.sku}</td>
                  <td>
                    <input
                      className="input"
                      style={{ width: 96 }}
                      defaultValue={(p.price_minor / 100).toFixed(2)}
                      inputMode="decimal"
                      aria-label={t('m.product.price')}
                      onBlur={(e) => {
                        const v = Math.round(parseFloat(e.target.value) * 100);
                        if (v > 0 && v !== p.price_minor) quick(p.id, { priceMinor: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: 80 }}
                      defaultValue={p.stock_qty}
                      inputMode="numeric"
                      aria-label={t('m.product.stock')}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (v >= 0 && v !== p.stock_qty) quick(p.id, { stockQty: v });
                      }}
                    />
                  </td>
                  <td>
                    <div className="row">
                      <Button size="small" variant="secondary" onClick={() => setEdit(p)}>
                        {t('common.edit')}
                      </Button>
                      <Button size="small" variant="ghost" onClick={() => setAlts(p)}>
                        {t('m.product.alternatives')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <ProductForm
          product={edit}
          storeId={b.stores[0]?.id}
          cats={cats.data ?? []}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
            reloadBiz();
          }}
        />
      )}
      {alts && <AltsModal product={alts} items={data?.items ?? []} onClose={() => setAlts(null)} />}
    </div>
  );
}
function ProductForm({
  product,
  storeId,
  cats,
  onClose,
  onSaved,
}: {
  product: any;
  storeId: string;
  cats: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, name } = useI18n();
  const isNew = !product.id;
  const [f, setF] = useState({
    categoryCode: product.category_code ?? 'rice',
    sku: product.sku ?? '',
    nameEn: product.name_en ?? '',
    nameAr: product.name_ar ?? '',
    brand: product.brand ?? '',
    sizeLabel: product.size_label ?? '',
    price: product.price_minor ? (product.price_minor / 100).toString() : '',
    compare: product.compare_at_minor ? (product.compare_at_minor / 100).toString() : '',
    stock: String(product.stock_qty ?? 0),
    tier: product.tier ?? 'standard',
    dietary: (product.dietary ?? []) as string[],
    allergens: (product.allergens ?? []) as string[],
    active: product.active ?? true,
    substitutable: product.substitutable ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      storeId,
      categoryCode: f.categoryCode,
      sku: f.sku,
      nameEn: f.nameEn,
      nameAr: f.nameAr,
      brand: f.brand,
      sizeLabel: f.sizeLabel,
      priceMinor: Math.round(parseFloat(f.price) * 100),
      compareAtMinor: f.compare ? Math.round(parseFloat(f.compare) * 100) : null,
      stockQty: parseInt(f.stock, 10) || 0,
      tier: f.tier,
      dietary: f.dietary,
      allergens: f.allergens,
      active: f.active,
      substitutable: f.substitutable,
    };
    try {
      await api(isNew ? '/merchant/products' : `/merchant/products/${product.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body,
      });
      toast(t('m.product.saved'));
      onSaved();
    } catch (er) {
      setError(er);
    }
  };
  return (
    <Modal title={isNew ? t('m.product.new') : t('common.edit')} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label={t('m.product.category')}>
          {(a) => (
            <select
              {...a}
              className="input"
              value={f.categoryCode}
              onChange={(e) => set('categoryCode', e.target.value)}
            >
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {name(c)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid cols-2">
          <TextInput
            label={t('m.product.sku')}
            value={f.sku}
            onChange={(v) => set('sku', v)}
            required
            dir="ltr"
          />
          <TextInput
            label={t('m.product.brand')}
            value={f.brand}
            onChange={(v) => set('brand', v)}
            required
          />
        </div>
        <TextInput
          label={t('m.product.name_en')}
          value={f.nameEn}
          onChange={(v) => set('nameEn', v)}
          required
        />
        <TextInput
          label={t('m.product.name_ar')}
          value={f.nameAr}
          onChange={(v) => set('nameAr', v)}
          required
          dir="rtl"
        />
        <div className="grid cols-3">
          <TextInput
            label={t('m.product.size')}
            value={f.sizeLabel}
            onChange={(v) => set('sizeLabel', v)}
            required
          />
          <TextInput
            label={t('m.product.price')}
            value={f.price}
            onChange={(v) => set('price', v)}
            inputMode="decimal"
            required
          />
          <TextInput
            label={t('m.product.stock')}
            value={f.stock}
            onChange={(v) => set('stock', v)}
            inputMode="numeric"
            required
          />
        </div>
        <TextInput
          label={t('m.product.compare')}
          hint={t('m.product.offer_note')}
          value={f.compare}
          onChange={(v) => set('compare', v)}
          inputMode="decimal"
        />
        <div className="field">
          <span className="label">{t('m.product.tier')}</span>
          <Chips
            value={f.tier}
            onChange={(v: string) => set('tier', v)}
            options={['value', 'standard', 'premium'].map((x) => ({
              value: x,
              label: t(`item.tier.${x}` as Key),
            }))}
          />
        </div>
        <div className="field">
          <span className="label">{t('m.product.dietary')}</span>
          <Chips
            multi
            value={f.dietary}
            onChange={(v: string[]) => set('dietary', v)}
            options={DIETS.map((x) => ({ value: x, label: t(`diet.${x}` as Key) }))}
          />
        </div>
        <div className="field">
          <span className="label">{t('m.product.allergens')}</span>
          <Chips
            multi
            value={f.allergens}
            onChange={(v: string[]) => set('allergens', v)}
            options={ALLERGENS.map((x) => ({ value: x, label: t(`allergen.${x}` as Key) }))}
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
            style={{ width: 22, height: 22 }}
          />{' '}
          {t('m.product.active')}
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={f.substitutable}
            onChange={(e) => set('substitutable', e.target.checked)}
            style={{ width: 22, height: 22 }}
          />{' '}
          {t('m.product.substitutable')}
        </label>
        <ErrorBox error={error} />
        <Button type="submit">{t('common.save')}</Button>
      </form>
    </Modal>
  );
}
function AltsModal({ product, items, onClose }: { product: any; items: any[]; onClose: () => void }) {
  const { t, name } = useI18n();
  const cands = items.filter((p) => p.category_code === product.category_code && p.id !== product.id);
  const cur = useLoad(
    () => api<{ alternatives: any[] }>(`/products/${product.id}/alternatives`),
    [product.id],
  );
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? cur.data?.alternatives.filter((a) => a.mappedByStore).map((a) => a.productId) ?? [];
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      title={`${t('m.product.alternatives')}: ${name({ en: product.name_en, ar: product.name_ar })}`}
      onClose={onClose}
    >
      <Chips
        multi
        value={chosen}
        onChange={setSel}
        options={cands.map((p) => ({
          value: p.id,
          label: `${name({ en: p.name_en, ar: p.name_ar })} · ${p.size_label}`,
        }))}
      />
      <ErrorBox error={error} />
      <Button
        onClick={async () => {
          try {
            await api(`/merchant/products/${product.id}/alternatives`, { body: { alternativeIds: chosen } });
            toast(t('m.product.saved'));
            onClose();
          } catch (e) {
            setError(e);
          }
        }}
      >
        {t('common.save')}
      </Button>
    </Modal>
  );
}

export function MReady() {
  const { t, name } = useI18n();
  const { b } = useCtx();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/merchant/ready-baskets'), []);
  const products = useLoad(() => api<any>('/merchant/products?limit=100'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    code: '',
    type: 'family_weekly',
    nameEn: '',
    nameAr: '',
    household: '4',
    days: '7',
    qty: {} as Record<string, number>,
  });
  const [err, setErr] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api('/merchant/ready-baskets', {
        body: {
          storeId: b.stores[0].id,
          code: f.code,
          basketType: f.type,
          nameEn: f.nameEn,
          nameAr: f.nameAr,
          householdSize: Number(f.household),
          durationDays: Number(f.days),
          items: Object.entries(f.qty)
            .filter(([, q]) => q > 0)
            .map(([productId, qty]) => ({ productId, qty })),
        },
      });
      setOpen(false);
      reload();
    } catch (er) {
      setErr(er);
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('m.ready')}</h1>
        <Button onClick={() => setOpen(true)}>＋ {t('m.ready.new')}</Button>
      </div>
      {loading ? (
        <SkeletonList n={2} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        (data ?? []).map((r) => (
          <Card key={r.id} className="row between">
            <div>
              <strong>{name({ en: r.name_en, ar: r.name_ar })}</strong>
              <div className="small muted">
                {t('ready.assumes', { household: r.household_size, days: r.duration_days })} ·{' '}
                {t('basket.lines', { n: r.items?.length ?? 0 })}
              </div>
            </div>
            <Button
              size="small"
              variant="ghost"
              onClick={async () => {
                await api(`/merchant/ready-baskets/${r.id}`, { method: 'DELETE' });
                reload();
              }}
            >
              {t('common.delete')}
            </Button>
          </Card>
        ))
      )}
      {open && (
        <Modal title={t('m.ready.new')} onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={save}>
            <TextInput
              label={t('m.ready.code')}
              value={f.code}
              onChange={(v) => setF({ ...f, code: v })}
              required
              dir="ltr"
            />
            <TextInput
              label={t('m.onboard.name_en')}
              value={f.nameEn}
              onChange={(v) => setF({ ...f, nameEn: v })}
              required
            />
            <TextInput
              label={t('m.onboard.name_ar')}
              value={f.nameAr}
              onChange={(v) => setF({ ...f, nameAr: v })}
              required
              dir="rtl"
            />
            <div className="field">
              <span className="label">{t('builder.type')}</span>
              <Chips
                value={f.type}
                onChange={(v: string) => setF({ ...f, type: v })}
                options={['family_weekly', 'budget', 'single', 'monthly', 'baby', 'healthy'].map((x) => ({
                  value: x,
                  label: t(`ready.type.${x}` as Key),
                }))}
              />
            </div>
            <div className="grid cols-2">
              <TextInput
                label={t('builder.household')}
                value={f.household}
                onChange={(v) => setF({ ...f, household: v })}
                inputMode="numeric"
              />
              <TextInput
                label={t('builder.days')}
                value={f.days}
                onChange={(v) => setF({ ...f, days: v })}
                inputMode="numeric"
              />
            </div>
            <div className="field">
              <span className="label">{t('m.ready.pick')}</span>
              <div className="table-wrap" style={{ maxHeight: 260 }}>
                <table className="table">
                  <tbody>
                    {(products.data?.items ?? [])
                      .filter((p: any) => p.active)
                      .map((p: any) => (
                        <tr key={p.id}>
                          <td>{name({ en: p.name_en, ar: p.name_ar })}</td>
                          <td>
                            <input
                              className="input"
                              style={{ width: 70 }}
                              inputMode="numeric"
                              aria-label={t('item.qty')}
                              value={f.qty[p.id] ?? ''}
                              onChange={(e) =>
                                setF({
                                  ...f,
                                  qty: { ...f.qty, [p.id]: Math.max(0, parseInt(e.target.value, 10) || 0) },
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <ErrorBox error={err} />
            <Button type="submit">{t('common.create')}</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function MReports() {
  const { t, name } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any>('/merchant/reports'), []);
  if (loading) return <SkeletonList n={2} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack">
      <h1>{t('m.reports')}</h1>
      <p className="muted">{t('m.reports.window')}</p>
      <div className="kpis">
        <Card>
          <div className="small muted">{t('m.reports.revenue')}</div>
          <div className="kpi">
            <Money minor={data.revenue_minor} />
          </div>
        </Card>
        <Card>
          <div className="small muted">{t('m.reports.delivered')}</div>
          <div className="kpi num">{data.delivered_orders}</div>
        </Card>
        <Card>
          <div className="small muted">{t('m.reports.cancelled')}</div>
          <div className="kpi num">{data.cancelled_orders}</div>
        </Card>
        <Card>
          <div className="small muted">{t('m.reports.avg')}</div>
          <div className="kpi">
            <Money minor={data.avg_order_minor} />
          </div>
        </Card>
      </div>
      {data.analytics === 'advanced' ? (
        <div className="grid cols-2">
          <Card>
            <h3>{t('m.reports.top')}</h3>
            <ul className="facts">
              {data.topProducts.map((p: any, i: number) => (
                <li key={i}>
                  {name({ en: p.name_en, ar: p.name_ar })} · <span className="num">{p.units}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3>{t('m.reports.subst')}</h3>
            <div className="kpi num">{data.substitutionRate.accepted_pct}%</div>
            <div className="small muted">{data.substitutionRate.requests}</div>
            <h3>{t('m.reports.response')}</h3>
            <div className="kpi num">{data.avgResponseMinutes}</div>
          </Card>
        </div>
      ) : (
        <Alert tone="info">{t('m.reports.upgrade')}</Alert>
      )}
      <a
        className="btn secondary small"
        href="#"
        onClick={async (e) => {
          e.preventDefault();
          const r = await api<any>('/merchant/export');
          const u = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = u;
          a.download = 'business-export.json';
          a.click();
        }}
      >
        {t('m.export')} ⬇
      </a>
    </div>
  );
}

export function MStaff() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/merchant/staff'), []);
  const [phone, setPhone] = useState('');
  const [perms, setPerms] = useState<string[]>(['orders', 'conversations']);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack">
      <h1>{t('m.staff')}</h1>
      {loading ? (
        <SkeletonList n={2} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        (data ?? []).map((s) => (
          <Card key={s.user_id} className="row between">
            <div>
              <strong>{s.name ?? s.phone}</strong>
              <div className="small muted num">{s.phone}</div>
              <div className="small">
                {s.member_role === 'owner'
                  ? t('m.staff.owner')
                  : (s.permissions as string[]).map((p) => t(`m.perm.${p}` as Key)).join(' · ')}
              </div>
            </div>
            {s.member_role !== 'owner' && (
              <Button
                size="small"
                variant="ghost"
                onClick={async () => {
                  await api(`/merchant/staff/${s.user_id}`, { method: 'DELETE' });
                  reload();
                }}
              >
                {t('common.remove')}
              </Button>
            )}
          </Card>
        ))
      )}
      <Card className="stack">
        <h2>{t('m.staff.add')}</h2>
        <p className="hint">{t('m.staff.note')}</p>
        <TextInput label={t('common.phone')} value={phone} onChange={setPhone} dir="ltr" />
        <div className="field">
          <span className="label">{t('m.staff.perms')}</span>
          <Chips
            multi
            value={perms}
            onChange={setPerms}
            options={['catalog', 'orders', 'conversations', 'reports'].map((p) => ({
              value: p,
              label: t(`m.perm.${p}` as Key),
            }))}
          />
        </div>
        <ErrorBox error={err} />
        <div>
          <Button
            onClick={async () => {
              setErr(null);
              try {
                await api('/merchant/staff', { body: { phone, permissions: perms } });
                setPhone('');
                reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('common.add')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function MPackage() {
  const { t, name, money } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any>('/merchant/package'), []);
  const { reload: reloadBiz } = useCtx();
  const [err, setErr] = useState<unknown>(null);
  if (loading) return <SkeletonList n={2} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const choose = async (code: string) => {
    setErr(null);
    try {
      await api('/merchant/package', { body: { packageCode: code } });
      toast(t('m.pkg.changed'));
      reload();
      reloadBiz();
    } catch (e) {
      setErr(e);
    }
  };
  const over =
    err instanceof ApiError && err.code === 'DOWNGRADE_BLOCKED' ? (err.details?.over as any[]) : null;
  return (
    <div className="stack">
      <h1>{t('m.package')}</h1>
      <Alert tone="info">{t('m.pkg.billing_note')}</Alert>
      <p>
        {t('m.pkg.usage', {
          products: data.usage.products,
          ready: data.usage.ready_baskets,
          staff: data.usage.staff,
        })}
      </p>
      {over ? (
        <Alert tone="bad" title={t('error.DOWNGRADE_BLOCKED')}>
          <ul>
            {over.map((o, i) => (
              <li key={i}>
                {o.what}: {o.used} / {o.max}
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <ErrorBox error={err} />
      )}
      <div className="grid cols-2">
        {data.available.map((p: any) => (
          <Card key={p.code} className="stack">
            <div className="row between">
              <h3 style={{ margin: 0 }}>{name({ en: p.name_en, ar: p.name_ar })}</h3>
              {data.current.code === p.code && <Badge tone="ok">{t('m.pkg.current')}</Badge>}
            </div>
            <div>
              {t('m.pkg.price', {
                amount: money(p.price_minor),
                interval: t(`m.pkg.${p.billing_interval}` as Key),
              })}
            </div>
            <PackageLimits e={p.entitlements} />
            {data.current.code !== p.code && (
              <Button size="small" onClick={() => choose(p.code)}>
                {t('m.pkg.choose')}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function MStore() {
  const { t, name } = useI18n();
  const { b, reload } = useCtx();
  const { areas } = useApp();
  const s = b.stores[0];
  const [f, setF] = useState({
    nameEn: s.name_en,
    nameAr: s.name_ar,
    fee: (s.delivery_fee_minor / 100).toString(),
    free: s.free_delivery_over_minor ? (s.free_delivery_over_minor / 100).toString() : '',
    min: (s.min_order_minor / 100).toString(),
    etaMin: String(s.eta_min_minutes),
    etaMax: String(s.eta_max_minutes),
    cod: s.accepts_cod,
    active: s.active,
    open: s.opening_hours.open,
    close: s.opening_hours.close,
    areaIds: s.areas as string[],
  });
  const [err, setErr] = useState<unknown>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await api(`/merchant/store/${s.id}`, {
            method: 'PUT',
            body: {
              nameEn: f.nameEn,
              nameAr: f.nameAr,
              deliveryFeeMinor: Math.round(parseFloat(f.fee || '0') * 100),
              freeDeliveryOverMinor: f.free ? Math.round(parseFloat(f.free) * 100) : null,
              minOrderMinor: Math.round(parseFloat(f.min || '0') * 100),
              etaMinMinutes: Number(f.etaMin),
              etaMaxMinutes: Number(f.etaMax),
              acceptsCod: f.cod,
              active: f.active,
              openingHours: { open: f.open, close: f.close },
              areaIds: f.areaIds,
            },
          });
          toast(t('m.store.saved'));
          reload();
        } catch (er) {
          setErr(er);
        }
      }}
    >
      <h1>{t('m.store')}</h1>
      <ErrorBox error={err} />
      <Card className="stack">
        <TextInput
          label={t('m.onboard.store_en')}
          value={f.nameEn}
          onChange={(v) => setF({ ...f, nameEn: v })}
          required
        />
        <TextInput
          label={t('m.onboard.store_ar')}
          value={f.nameAr}
          onChange={(v) => setF({ ...f, nameAr: v })}
          required
          dir="rtl"
        />
        <div className="grid cols-3">
          <TextInput
            label={t('m.onboard.fee')}
            value={f.fee}
            onChange={(v) => setF({ ...f, fee: v })}
            inputMode="decimal"
          />
          <TextInput
            label={t('m.onboard.free_over')}
            value={f.free}
            onChange={(v) => setF({ ...f, free: v })}
            inputMode="decimal"
          />
          <TextInput
            label={t('m.onboard.min')}
            value={f.min}
            onChange={(v) => setF({ ...f, min: v })}
            inputMode="decimal"
          />
        </div>
        <div className="grid cols-2">
          <TextInput
            label={t('m.store.eta_min')}
            value={f.etaMin}
            onChange={(v) => setF({ ...f, etaMin: v })}
            inputMode="numeric"
          />
          <TextInput
            label={t('m.store.eta_max')}
            value={f.etaMax}
            onChange={(v) => setF({ ...f, etaMax: v })}
            inputMode="numeric"
          />
          <TextInput
            label={t('m.store.hours_open')}
            value={f.open}
            onChange={(v) => setF({ ...f, open: v })}
            dir="ltr"
          />
          <TextInput
            label={t('m.store.hours_close')}
            value={f.close}
            onChange={(v) => setF({ ...f, close: v })}
            dir="ltr"
          />
        </div>
        <div className="field">
          <span className="label">{t('m.onboard.areas')}</span>
          <Chips
            multi
            value={f.areaIds}
            onChange={(v: string[]) => setF({ ...f, areaIds: v })}
            options={areas.map((a) => ({ value: a.id, label: name(a) }))}
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={f.cod}
            onChange={(e) => setF({ ...f, cod: e.target.checked })}
            style={{ width: 22, height: 22 }}
          />{' '}
          {t('m.store.cod')}
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
            style={{ width: 22, height: 22 }}
          />{' '}
          {t('m.store.active')}
        </label>
        <div>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </Card>
    </form>
  );
}
