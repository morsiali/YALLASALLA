import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
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
import { PackageLimits } from '../merchant/Merchant';

export function AdminLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'support') nav('/');
  }, [user, nav]);
  const admin = user?.role === 'admin';
  const links: [string, Key, boolean][] = [
    ['/admin', 'a.dashboard', admin],
    ['/admin/merchants', 'a.merchants', true],
    ['/admin/orders', 'a.orders', true],
    ['/admin/disputes', 'a.disputes', true],
    ['/admin/users', 'a.users', true],
    ['/admin/packages', 'a.packages', admin],
    ['/admin/areas', 'a.areas', admin],
    ['/admin/rules', 'a.rules', admin],
    ['/admin/loyalty', 'a.loyalty', admin],
    ['/admin/audit', 'a.audit', admin],
    ['/admin/providers', 'a.providers', admin],
  ];
  return (
    <div className="layout-sidebar">
      <nav className="side" aria-label={t('a.title')}>
        {links
          .filter((l) => l[2])
          .map(([to, k]) => (
            <NavLink key={to} to={to} end={to === '/admin'}>
              {t(k)}
            </NavLink>
          ))}
      </nav>
      <div className="stack">
        {!admin && <Alert tone="info">{t('a.support_limited')}</Alert>}
        <Outlet />
      </div>
    </div>
  );
}

export function ADashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (user?.role === 'support') nav('/admin/orders', { replace: true });
  }, [user, nav]);
  const { data, loading, error, reload } = useLoad(
    () => (user?.role === 'admin' ? api<any>('/admin/kpis') : Promise.resolve(null)),
    [user?.role],
  );
  if (loading) return <SkeletonList n={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
  const items: [Key, string | number][] = [
    ['a.kpi.baskets', data.basketsGenerated],
    ['a.kpi.conv', pct(data.basketToOrderPct)],
    ['a.kpi.ttb', `${data.avgTimeToBasketMs} ms`],
    ['a.kpi.modified', pct(data.basketModifiedPct)],
    ['a.kpi.fallback', pct(data.fallbackPct)],
    ['a.kpi.orders', data.orders],
    ['a.kpi.cancel', pct(data.cancellationPct)],
    ['a.kpi.repeat', data.repeatOrders],
    ['a.kpi.subst', pct(data.substitutionAcceptancePct)],
    ['a.kpi.conv2o', pct(data.conversationToOrderPct)],
    ['a.kpi.accept', data.avgMerchantAcceptMinutes],
    ['a.kpi.disputes', data.disputes],
    ['a.kpi.reports', data.openReports],
    ['a.kpi.pending', data.pendingMerchants],
  ];
  return (
    <div className="stack">
      <h1>{t('a.dashboard')}</h1>
      <div className="kpis">
        {items.map(([k, v]) => (
          <Card key={k}>
            <div className="small muted">{t(k)}</div>
            <div className="kpi num">{v}</div>
          </Card>
        ))}
        <Card>
          <div className="small muted">{t('a.kpi.aov')}</div>
          <div className="kpi">
            <Money minor={data.avgOrderMinor} />
          </div>
        </Card>
      </div>
      <Card>
        <div className="small muted">{t('a.kpi.loyalty')}</div>
        <div className="strong num">
          {data.loyalty.earned} / {data.loyalty.redeemed} / {data.loyalty.reversed} / {data.loyalty.expired}
        </div>
      </Card>
      <p className="hint">{t('a.kpi.note')}</p>
    </div>
  );
}

export function AMerchants() {
  const { t, name } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/admin/businesses'), []);
  const [sel, setSel] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const review = async (decision: string) => {
    setErr(null);
    try {
      await api(`/admin/businesses/${sel.id}/review`, { body: { decision, note: note || undefined } });
      toast(t('a.review.done'));
      setSel(null);
      setNote('');
      reload();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="stack">
      <h1>{t('a.merchants')}</h1>
      {loading ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('m.onboard.license')}</th>
                <th>{t('common.status')}</th>
                <th>{t('m.onboard.package')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{name(b)}</strong>
                  </td>
                  <td className="num">{b.trade_license_no}</td>
                  <td>
                    <Badge tone={b.status === 'approved' ? 'ok' : b.status === 'pending' ? 'warn' : 'bad'}>
                      {t(`m.status.${b.status}` as Key)}
                    </Badge>
                  </td>
                  <td>{b.package_code}</td>
                  <td>
                    <Button size="small" variant="secondary" onClick={() => setSel(b)}>
                      {t('common.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <Modal title={name(sel)} onClose={() => setSel(null)}>
          <p className="small">
            {sel.trade_license_no} · {sel.contact_phone} · {t('m.catalog')}: {sel.product_count}
          </p>
          <TextInput label={t('a.review.note')} value={note} onChange={setNote} />
          <ErrorBox error={err} />
          <div className="row">
            {sel.status === 'pending' && (
              <Button onClick={() => review('approve')}>{t('a.review.approve')}</Button>
            )}
            {['pending', 'approved'].includes(sel.status) && (
              <Button
                variant="danger"
                onClick={() => review(sel.status === 'approved' ? 'suspend' : 'reject')}
              >
                {t(sel.status === 'approved' ? 'a.review.suspend' : 'a.review.reject')}
              </Button>
            )}
            {sel.status === 'suspended' && (
              <Button onClick={() => review('reinstate')}>{t('a.review.reinstate')}</Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function APackages() {
  const { t, name, money } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/admin/packages'), []);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('a.packages')}</h1>
        <Button
          onClick={() =>
            setEdit({
              code: '',
              name_en: '',
              name_ar: '',
              price_minor: 0,
              billing_interval: 'month',
              trial_days: 0,
              active: true,
              entitlements: {
                max_products: 100,
                max_ready_baskets: 3,
                staff_seats: 2,
                messages_per_day: 500,
                analytics: 'basic',
                max_stores: 1,
              },
            })
          }
        >
          ＋ {t('a.pkg.new')}
        </Button>
      </div>
      {loading ? (
        <SkeletonList n={2} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="grid cols-2">
          {(data ?? []).map((p) => (
            <Card key={p.id} className="stack">
              <div className="row between">
                <h3 style={{ margin: 0 }}>
                  {name({ en: p.name_en, ar: p.name_ar })} <span className="small muted">({p.code})</span>
                </h3>
                {!p.active && <Badge tone="warn">off</Badge>}
              </div>
              <div>
                {t('m.pkg.price', {
                  amount: money(p.price_minor),
                  interval: t(`m.pkg.${p.billing_interval}` as Key),
                })}
              </div>
              <PackageLimits e={p.entitlements} />
              <div>
                <Button size="small" variant="secondary" onClick={() => setEdit(p)}>
                  {t('common.edit')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <PackageForm
          p={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
function PackageForm({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    code: p.code,
    nameEn: p.name_en,
    nameAr: p.name_ar,
    price: String(p.price_minor / 100),
    interval: p.billing_interval,
    trial: String(p.trial_days),
    active: p.active,
    ...p.entitlements,
  });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const body = {
      code: f.code,
      nameEn: f.nameEn,
      nameAr: f.nameAr,
      priceMinor: Math.round(parseFloat(f.price) * 100),
      billingInterval: f.interval,
      trialDays: Number(f.trial),
      active: f.active,
      entitlements: {
        max_products: Number(f.max_products),
        max_ready_baskets: Number(f.max_ready_baskets),
        staff_seats: Number(f.staff_seats),
        messages_per_day: Number(f.messages_per_day),
        analytics: f.analytics,
        max_stores: Number(f.max_stores),
      },
    };
    try {
      await api(p.id ? `/admin/packages/${p.id}` : '/admin/packages', {
        method: p.id ? 'PUT' : 'POST',
        body,
      });
      onSaved();
    } catch (er) {
      setErr(er);
    }
  };
  return (
    <Modal title={t('a.pkg.new')} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid cols-2">
          <TextInput label="code" value={f.code} onChange={(v) => set('code', v)} required dir="ltr" />
          <TextInput
            label={t('m.product.price')}
            value={f.price}
            onChange={(v) => set('price', v)}
            inputMode="decimal"
          />
        </div>
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
        <div className="field">
          <span className="label">{t('a.pkg.limits')}</span>
          <div className="grid cols-2">
            {(
              ['max_products', 'max_ready_baskets', 'staff_seats', 'messages_per_day', 'max_stores'] as const
            ).map((k) => (
              <TextInput
                key={k}
                label={k}
                value={String(f[k])}
                onChange={(v) => set(k, v)}
                inputMode="numeric"
                dir="ltr"
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">{t('m.pkg.analytics', { level: '' })}</span>
          <Chips
            value={f.analytics}
            onChange={(v: string) => set('analytics', v)}
            options={[
              { value: 'basic', label: 'basic' },
              { value: 'advanced', label: 'advanced' },
            ]}
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
            style={{ width: 22, height: 22 }}
          />{' '}
          {t('a.rule.active')}
        </label>
        <ErrorBox error={err} />
        <Button type="submit">{t('a.pkg.save')}</Button>
      </form>
    </Modal>
  );
}

export function AAreas() {
  const { t, name } = useI18n();
  const { areas } = useApp();
  const stores = useLoad(() => api<any[]>('/stores'), []);
  const [f, setF] = useState({ emirate: 'Dubai', nameEn: '', nameAr: '' });
  const [err, setErr] = useState<unknown>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  return (
    <div className="stack">
      <h1>{t('a.areas')}</h1>
      <Card>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {areas.map((a) => (
                <tr key={a.id}>
                  <td>{a.emirate}</td>
                  <td>{name(a)}</td>
                  <td>
                    <Badge tone={a.served ? 'ok' : 'warn'}>
                      {a.served ? t('area.served') : t('area.not_served')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="stack">
        <h2>{t('a.area.store_areas')}</h2>
        {(stores.data ?? []).map((s) => (
          <div key={s.id} className="row between">
            <span>
              {name(s)} · {(s.areas as any[]).map((a) => name(a)).join(' · ')}
            </span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setEdit(s);
                setSel((s.areas as any[]).map((a) => a.id));
              }}
            >
              {t('common.edit')}
            </Button>
          </div>
        ))}
      </Card>
      <Card className="stack">
        <h2>{t('a.area.add')}</h2>
        <ErrorBox error={err} />
        <div className="grid cols-3">
          <TextInput
            label={t('a.area.emirate')}
            value={f.emirate}
            onChange={(v) => setF({ ...f, emirate: v })}
          />
          <TextInput
            label={t('m.onboard.name_en')}
            value={f.nameEn}
            onChange={(v) => setF({ ...f, nameEn: v })}
          />
          <TextInput
            label={t('m.onboard.name_ar')}
            value={f.nameAr}
            onChange={(v) => setF({ ...f, nameAr: v })}
            dir="rtl"
          />
        </div>
        <div>
          <Button
            onClick={async () => {
              setErr(null);
              try {
                await api('/admin/areas', { body: f });
                toast(t('profile.saved'));
                location.reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('common.add')}
          </Button>
        </div>
      </Card>
      {edit && (
        <Modal title={name(edit)} onClose={() => setEdit(null)}>
          <Chips
            multi
            value={sel}
            onChange={setSel}
            options={areas.map((a) => ({ value: a.id, label: name(a) }))}
          />
          <TextInput label={t('common.reason')} value={reason} onChange={setReason} />
          <ErrorBox error={err} />
          <Button
            onClick={async () => {
              setErr(null);
              try {
                await api(`/admin/stores/${edit.id}/areas`, {
                  method: 'PUT',
                  body: { areaIds: sel, reason },
                });
                setEdit(null);
                stores.reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </Modal>
      )}
    </div>
  );
}

export function ARules() {
  const { t, name } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/admin/basket-rules'), []);
  const [edit, setEdit] = useState<any | null>(null);
  const [f, setF] = useState<any>({});
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack">
      <h1>{t('a.rules')}</h1>
      {loading ? (
        <SkeletonList n={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('m.product.category')}</th>
                <th>{t('a.rule.units')}</th>
                <th>{t('a.rule.priority')}</th>
                <th>{t('a.rule.min')}</th>
                <th>{t('a.rule.max')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{name(r)}</td>
                  <td className="num">{r.units_per_person_week}</td>
                  <td>{t(`a.rule.priority.${r.priority}` as Key)}</td>
                  <td className="num">{r.min_units}</td>
                  <td className="num">{r.max_units}</td>
                  <td>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => {
                        setEdit(r);
                        setF({
                          units: String(r.units_per_person_week),
                          priority: r.priority,
                          min: String(r.min_units),
                          max: String(r.max_units),
                          boost: String(r.high_protein_boost),
                          active: r.active,
                          reason: '',
                        });
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={name(edit)} onClose={() => setEdit(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try {
                await api(`/admin/basket-rules/${edit.id}`, {
                  method: 'PUT',
                  body: {
                    unitsPerPersonWeek: Number(f.units),
                    priority: f.priority,
                    minUnits: Number(f.min),
                    maxUnits: Number(f.max),
                    highProteinBoost: Number(f.boost),
                    active: f.active,
                    reason: f.reason,
                  },
                });
                setEdit(null);
                reload();
              } catch (er) {
                setErr(er);
              }
            }}
          >
            <div className="grid cols-2">
              <TextInput
                label={t('a.rule.units')}
                value={f.units}
                onChange={(v) => setF({ ...f, units: v })}
                inputMode="decimal"
              />
              <TextInput
                label={t('a.rule.boost')}
                value={f.boost}
                onChange={(v) => setF({ ...f, boost: v })}
                inputMode="decimal"
              />
              <TextInput
                label={t('a.rule.min')}
                value={f.min}
                onChange={(v) => setF({ ...f, min: v })}
                inputMode="numeric"
              />
              <TextInput
                label={t('a.rule.max')}
                value={f.max}
                onChange={(v) => setF({ ...f, max: v })}
                inputMode="numeric"
              />
            </div>
            <Chips
              value={f.priority}
              onChange={(v: string) => setF({ ...f, priority: v })}
              options={['essential', 'standard', 'optional'].map((x) => ({
                value: x,
                label: t(`a.rule.priority.${x}` as Key),
              }))}
            />
            <label className="row">
              <input
                type="checkbox"
                checked={f.active}
                onChange={(e) => setF({ ...f, active: e.target.checked })}
                style={{ width: 22, height: 22 }}
              />{' '}
              {t('a.rule.active')}
            </label>
            <TextInput
              label={t('common.reason')}
              value={f.reason}
              onChange={(v) => setF({ ...f, reason: v })}
              required
              minLength={5}
            />
            <ErrorBox error={err} />
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function ALoyalty() {
  const { t } = useI18n();
  const { config } = useApp();
  const r = config?.loyalty;
  const [f, setF] = useState<any>(null);
  const [adj, setAdj] = useState({ userId: '', points: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (r && !f)
      setF({
        earn: String(r.earnPointsPerAed),
        hold: String(r.holdDays),
        value: String(r.pointValueMinor),
        min: String(r.minRedeemPoints),
        max: String(r.maxRedeemPctOfSubtotal),
        expiry: String(r.expiryDays),
        cap: String(r.dailyEarnCapPoints),
        reason: '',
      });
  }, [r, f]);
  const users = useLoad(() => api<any[]>('/admin/users'), []);
  if (!f) return <SkeletonList n={2} />;
  return (
    <div className="stack">
      <h1>{t('a.loyalty')}</h1>
      <Card>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await api('/admin/loyalty-rules', {
                method: 'PUT',
                body: {
                  earnPointsPerAed: Number(f.earn),
                  holdDays: Number(f.hold),
                  pointValueMinor: Number(f.value),
                  minRedeemPoints: Number(f.min),
                  maxRedeemPctOfSubtotal: Number(f.max),
                  expiryDays: Number(f.expiry),
                  dailyEarnCapPoints: Number(f.cap),
                  reason: f.reason,
                },
              });
              toast(t('profile.saved'));
            } catch (er) {
              setErr(er);
            }
          }}
        >
          <h2>{t('a.loyalty.rules')}</h2>
          <div className="grid cols-3">
            {(
              [
                ['earn', 'a.loyalty.earn'],
                ['hold', 'a.loyalty.hold'],
                ['value', 'a.loyalty.value'],
                ['min', 'a.loyalty.min'],
                ['max', 'a.loyalty.max'],
                ['expiry', 'a.loyalty.expiry'],
                ['cap', 'a.loyalty.cap'],
              ] as [string, Key][]
            ).map(([k, l]) => (
              <TextInput
                key={k}
                label={t(l)}
                value={f[k]}
                onChange={(v) => setF({ ...f, [k]: v })}
                inputMode="decimal"
              />
            ))}
          </div>
          <TextInput
            label={t('common.reason')}
            value={f.reason}
            onChange={(v) => setF({ ...f, reason: v })}
            required
            minLength={5}
          />
          <ErrorBox error={err} />
          <div>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Card>
      <Card className="stack">
        <h2>{t('a.loyalty.adjust')}</h2>
        <Field label={t('a.loyalty.adjust.user')}>
          {(a) => (
            <select
              {...a}
              className="input"
              value={adj.userId}
              onChange={(e) => setAdj({ ...adj, userId: e.target.value })}
            >
              <option value="">—</option>
              {(users.data ?? [])
                .filter((u) => u.role === 'customer')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.phone} · {u.phone}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <TextInput
          label={t('a.loyalty.adjust.points')}
          value={adj.points}
          onChange={(v) => setAdj({ ...adj, points: v })}
          inputMode="numeric"
          dir="ltr"
        />
        <TextInput
          label={t('common.reason')}
          value={adj.reason}
          onChange={(v) => setAdj({ ...adj, reason: v })}
          minLength={5}
        />
        <div>
          <Button
            onClick={async () => {
              setErr(null);
              try {
                await api('/admin/loyalty/adjust', {
                  body: { userId: adj.userId, points: parseInt(adj.points, 10), reason: adj.reason },
                });
                toast(t('a.loyalty.adjust.done'));
                setAdj({ userId: '', points: '', reason: '' });
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('common.update')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function AOrders() {
  const { t, date } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/admin/orders'), []);
  const [sel, setSel] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack">
      <h1>{t('a.orders')}</h1>
      {loading ? (
        <SkeletonList n={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {(data ?? []).map((o) => (
                <tr key={o.id}>
                  <td className="num">#{o.order_no}</td>
                  <td>{o.store_name_en}</td>
                  <td>
                    <Badge
                      tone={
                        o.status === 'delivered'
                          ? 'ok'
                          : ['cancelled', 'rejected'].includes(o.status)
                            ? 'bad'
                            : 'info'
                      }
                    >
                      {t(`status.${o.status}` as Key)}
                    </Badge>
                  </td>
                  <td>
                    <Money minor={o.total_minor} />
                  </td>
                  <td className="small">{date(o.placed_at)}</td>
                  <td>
                    {!['delivered', 'cancelled', 'rejected'].includes(o.status) && (
                      <Button size="small" variant="ghost" onClick={() => setSel(o)}>
                        {t('common.cancel')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <Modal title={`#${sel.order_no}`} onClose={() => setSel(null)}>
          <TextInput label={t('common.reason')} value={reason} onChange={setReason} minLength={5} />
          <ErrorBox error={err} />
          <Button
            variant="danger"
            onClick={async () => {
              setErr(null);
              try {
                await api(`/admin/orders/${sel.id}/status`, { body: { to: 'cancelled', reason } });
                setSel(null);
                setReason('');
                reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('order.cancel')}
          </Button>
        </Modal>
      )}
    </div>
  );
}

export function ADisputes() {
  const { t, date } = useI18n();
  const disputes = useLoad(() => api<any[]>('/admin/disputes'), []);
  const reports = useLoad(() => api<any[]>('/admin/reports'), []);
  const [sel, setSel] = useState<any | null>(null);
  const [f, setF] = useState({ resolution: '', refund: '' });
  const [conv, setConv] = useState<any | null>(null);
  const [rsel, setRsel] = useState<any | null>(null);
  const [rres, setRres] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const resolve = async (status: 'resolved' | 'rejected') => {
    setErr(null);
    try {
      await api(`/admin/disputes/${sel.id}/resolve`, {
        body: {
          status,
          resolution: f.resolution,
          refundMinor: f.refund ? Math.round(parseFloat(f.refund) * 100) : undefined,
        },
      });
      setSel(null);
      setF({ resolution: '', refund: '' });
      disputes.reload();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="stack">
      <h1>{t('a.disputes')}</h1>
      <Card className="stack">
        <h2>{t('order.disputes')}</h2>
        {disputes.loading ? (
          <SkeletonList n={2} />
        ) : !(disputes.data ?? []).length ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          (disputes.data ?? []).map((d) => (
            <div key={d.id} className="row between card flat">
              <div>
                <strong>#{d.order_no}</strong>{' '}
                <Badge tone={d.status === 'resolved' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}>
                  {d.status}
                </Badge>
                <div className="small">{d.reason}</div>
                <div className="small muted">
                  {date(d.created_at)} · <Money minor={d.total_minor} />
                </div>
                {d.resolution && <div className="small muted">{d.resolution}</div>}
              </div>
              {['open', 'under_review'].includes(d.status) && (
                <div className="row">
                  {d.status === 'open' && (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={async () => {
                        await api(`/admin/disputes/${d.id}/review`, { body: {} });
                        disputes.reload();
                      }}
                    >
                      {t('a.dispute.review')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => setSel(d)}>
                    {t('a.dispute.resolve')}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </Card>
      <Card className="stack">
        <h2>{t('help.report')}</h2>
        {!(reports.data ?? []).length ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          (reports.data ?? []).map((r) => (
            <div key={r.id} className="row between card flat">
              <div>
                <Badge tone={r.status === 'open' ? 'warn' : 'ok'}>{r.status}</Badge>{' '}
                <strong>{r.target_type}</strong>
                <div className="small">{r.reason}</div>
              </div>
              {r.status === 'open' && (
                <div className="row">
                  {['conversation', 'message'].includes(r.target_type) && (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          setConv(await api(`/admin/reports/${r.id}/conversation`));
                        } catch (e) {
                          setErr(e);
                        }
                      }}
                    >
                      {t('a.report.read')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => setRsel(r)}>
                    {t('a.dispute.resolve')}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </Card>
      <ErrorBox error={err} />
      {sel && (
        <Modal title={`#${sel.order_no}`} onClose={() => setSel(null)}>
          <TextInput
            label={t('a.dispute.resolution')}
            value={f.resolution}
            onChange={(v) => setF({ ...f, resolution: v })}
            minLength={5}
          />
          <TextInput
            label={t('a.dispute.refund')}
            value={f.refund}
            onChange={(v) => setF({ ...f, refund: v })}
            inputMode="decimal"
          />
          <ErrorBox error={err} />
          <div className="row">
            <Button onClick={() => resolve('resolved')}>{t('a.dispute.resolve')}</Button>
            <Button variant="secondary" onClick={() => resolve('rejected')}>
              {t('a.dispute.reject')}
            </Button>
          </div>
        </Modal>
      )}
      {rsel && (
        <Modal title={rsel.target_type} onClose={() => setRsel(null)}>
          <TextInput label={t('a.dispute.resolution')} value={rres} onChange={setRres} minLength={5} />
          <div className="row">
            <Button
              onClick={async () => {
                await api(`/admin/reports/${rsel.id}/resolve`, {
                  body: { status: 'actioned', resolution: rres },
                });
                setRsel(null);
                setRres('');
                reports.reload();
              }}
            >
              {t('a.report.actioned')}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await api(`/admin/reports/${rsel.id}/resolve`, {
                  body: { status: 'dismissed', resolution: rres },
                });
                setRsel(null);
                setRres('');
                reports.reload();
              }}
            >
              {t('a.report.dismissed')}
            </Button>
          </div>
        </Modal>
      )}
      {conv && (
        <Modal title={t('chat.title')} onClose={() => setConv(null)}>
          {conv.messages.map((m: any) => (
            <div key={m.id} className="small">
              <strong>{m.sender_side}</strong>: {m.body ?? `[${m.kind}]`}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

export function AUsers() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(
    () => api<any[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    [q],
  );
  const [sel, setSel] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack">
      <h1>{t('a.users')}</h1>
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('common.search')}
        aria-label={t('common.search')}
      />
      {loading && !data ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td>{u.name ?? '—'}</td>
                  <td className="num">{u.phone}</td>
                  <td>{u.role}</td>
                  <td>
                    <Badge tone={u.status === 'active' ? 'ok' : 'warn'}>{u.status}</Badge>
                  </td>
                  <td>
                    {user?.role === 'admin' && u.role !== 'admin' && u.status !== 'deleted' && (
                      <Button size="small" variant="ghost" onClick={() => setSel(u)}>
                        {u.status === 'active' ? t('a.user.restrict') : t('a.user.activate')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <Modal title={sel.name ?? sel.phone} onClose={() => setSel(null)}>
          <TextInput label={t('common.reason')} value={reason} onChange={setReason} minLength={5} />
          <ErrorBox error={err} />
          <Button
            onClick={async () => {
              setErr(null);
              try {
                await api(`/admin/users/${sel.id}/status`, {
                  body: { status: sel.status === 'active' ? 'restricted' : 'active', reason },
                });
                setSel(null);
                setReason('');
                reload();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        </Modal>
      )}
    </div>
  );
}

export function AAudit() {
  const { t, date } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/admin/audit'), []);
  return (
    <div className="stack">
      <h1>{t('a.audit')}</h1>
      {loading ? (
        <SkeletonList n={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !(data ?? []).length ? (
        <Card>{t('a.audit.empty')}</Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>action</th>
                <th>entity</th>
                <th>{t('common.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="small">{date(a.created_at)}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td className="small">
                    {a.entity} {a.entity_id ? `· ${String(a.entity_id).slice(0, 8)}` : ''}
                  </td>
                  <td className="small">{a.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AProviders() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any>('/admin/providers'), []);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (loading) return <SkeletonList n={2} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack">
      <h1>{t('a.providers')}</h1>
      <Alert tone="info">{t('a.providers.note')}</Alert>
      <div className="kpis">
        {Object.entries(data)
          .filter(([k]) => k !== 'secretsConfigured')
          .map(([k, v]: [string, any]) => (
            <Card key={k}>
              <div className="small muted">{k}</div>
              <div className="strong">{v.mode ?? v.name}</div>
              {(v.mode === 'mock' || v.mode === 'sandbox') && <Badge tone="test">{v.mode}</Badge>}
            </Card>
          ))}
      </div>
      <Card className="stack">
        <Button
          variant="secondary"
          onClick={async () => {
            setErr(null);
            try {
              setOut(JSON.stringify(await api('/admin/jobs/run', { body: {} })));
            } catch (e) {
              setErr(e);
            }
          }}
        >
          {t('a.jobs.run')}
        </Button>
        {out && <Alert tone="ok">{t('a.jobs.done', { stats: out })}</Alert>}
        <ErrorBox error={err} />
      </Card>
    </div>
  );
}
