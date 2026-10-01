import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  Money,
  SkeletonList,
  TextInput,
  toast,
  useLoad,
} from '../../components/ui';

export function LoyaltyPage() {
  const { t, date, money, days } = useI18n();
  const { tick } = useAuth();
  const { config } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>('/loyalty'), [tick]);
  if (loading && !data) return <SkeletonList n={3} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const r = data.rules ?? config?.loyalty;
  return (
    <div className="stack">
      <h1>{t('loyalty.title')}</h1>
      <div className="kpis">
        <Card>
          <div className="small muted">{t('loyalty.available')}</div>
          <div className="kpi num">{data.available}</div>
          <div className="small">
            {t('loyalty.value', { amount: money(data.available * r.pointValueMinor) })}
          </div>
        </Card>
        <Card>
          <div className="small muted">{t('loyalty.pending')}</div>
          <div className="kpi num">{data.pending}</div>
          <div className="small muted">{t('loyalty.rule.hold', { days: days(r.holdDays) })}</div>
        </Card>
      </div>
      <Card>
        <h2>{t('loyalty.rules')}</h2>
        <ul className="facts">
          <li>{t('loyalty.rule.earn', { rate: r.earnPointsPerAed })}</li>
          <li>{t('loyalty.rule.hold', { days: days(r.holdDays) })}</li>
          <li>
            {t('loyalty.rule.redeem', {
              pts: Math.round(100 / r.pointValueMinor),
              amount: money(100),
              min: r.minRedeemPoints,
              pct: r.maxRedeemPctOfSubtotal,
            })}
          </li>
          <li>{t('loyalty.rule.expiry', { days: days(r.expiryDays) })}</li>
          <li>{t('loyalty.rule.reversal')}</li>
          <li>{t('loyalty.rule.cap', { cap: r.dailyEarnCapPoints })}</li>
        </ul>
      </Card>
      <Card>
        <h2>{t('loyalty.history')}</h2>
        {!data.ledger.length ? (
          <p className="muted">{t('loyalty.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.reason')}</th>
                  <th>#</th>
                  <th>{t('loyalty.title')}</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((l: any) => (
                  <tr key={l.id}>
                    <td>{date(l.created_at, false)}</td>
                    <td>
                      <Badge tone={l.status === 'reversed' ? 'bad' : l.status === 'pending' ? 'warn' : 'ok'}>
                        {t(`loyalty.kind.${l.kind}` as Key)}
                        {l.status !== 'posted' ? ` · ${t(`loyalty.status.${l.status}` as Key)}` : ''}
                      </Badge>
                      {l.status === 'pending' && (
                        <div className="small muted">
                          {t('loyalty.available_on', { date: date(l.available_at, false) })}
                        </div>
                      )}
                    </td>
                    <td>{l.reason}</td>
                    <td>{l.order_no ? <Link to="/orders">#{l.order_no}</Link> : '—'}</td>
                    <td className="num strong">
                      {l.points > 0 ? '+' : ''}
                      {l.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function SavedPage() {
  const { t, name } = useI18n();
  const nav = useNavigate();
  const { setBasket, setForm } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>('/saved'), []);
  if (loading) return <SkeletonList n={3} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const empty =
    !data.stores.length && !data.products.length && !data.baskets.length && !data.readyBaskets.length;
  const open = async (b: any) => {
    const st = await api<any>(`/stores/${b.store_id}`);
    setForm((f) => ({ ...f, ...b.constraints, scopeConfirmed: b.constraints?.budgetMinor != null }));
    setBasket({
      storeId: b.store_id,
      generationId: null,
      source: 'repeat',
      store: {
        id: st.id,
        name: { en: st.name_en, ar: st.name_ar },
        deliveryFeeMinor: st.delivery_fee_minor,
        freeDeliveryOverMinor: st.free_delivery_over_minor,
        minOrderMinor: st.min_order_minor,
      },
      items: b.items,
      original: b.items,
      facts: [],
      health: null,
      compared: 1,
      recovery: [],
    });
    nav('/basket');
  };
  const remove = async (kind: string, id: string) => {
    await api(`/saved/${kind}/${id}`, { method: 'DELETE' });
    reload();
  };
  return (
    <div className="stack">
      <h1>{t('saved.title')}</h1>
      {empty && <Card>{t('saved.empty')}</Card>}
      {data.baskets.length > 0 && (
        <section>
          <h2>{t('saved.baskets')}</h2>
          <div className="stack">
            {data.baskets.map((b: any) => (
              <Card key={b.id} className="row between">
                <div>
                  <div className="strong">{b.name}</div>
                  <div className="small muted">{t('basket.lines', { n: b.items.length })}</div>
                </div>
                <div className="row">
                  <Button size="small" onClick={() => open(b)}>
                    {t('saved.open')}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/saved/baskets/${b.id}`, { method: 'DELETE' });
                      reload();
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
      {data.stores.length > 0 && (
        <section>
          <h2>{t('saved.stores')}</h2>
          <div className="stack">
            {data.stores.map((s: any) => (
              <Card key={s.id} className="row between">
                <Link to={`/stores/${s.id}`}>{name(s)}</Link>
                <Button size="small" variant="ghost" onClick={() => remove('store', s.id)}>
                  {t('common.remove')}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}
      {data.products.length > 0 && (
        <section>
          <h2>{t('saved.products')}</h2>
          <div className="stack">
            {data.products.map((p: any) => (
              <Card key={p.id} className="row between">
                <div>
                  <Link to={`/products/${p.id}`}>{name(p)}</Link>
                  <div className="small muted">
                    {p.brand} · {p.size_label} · <Money minor={p.price_minor} />
                  </div>
                </div>
                <Button size="small" variant="ghost" onClick={() => remove('product', p.id)}>
                  {t('common.remove')}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}
      {data.readyBaskets.length > 0 && (
        <section>
          <h2>{t('saved.ready')}</h2>
          <div className="stack">
            {data.readyBaskets.map((r: any) => (
              <Card key={r.id}>
                <Link to={`/ready/${r.id}`}>{name(r)}</Link>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const DIETS = ['halal', 'vegetarian', 'gluten_free', 'organic', 'high_protein', 'low_sugar'];
const ALLERGENS = ['nuts', 'dairy', 'gluten', 'eggs', 'soy', 'fish'];

export function AccountPage() {
  const { t, name, locale, setLocale, date } = useI18n();
  const nav = useNavigate();
  const { user, logout, tick } = useAuth();
  const { areas, setForm } = useApp();
  const me = useLoad(() => api<any>('/auth/me'), [user?.id]);
  const addrs = useLoad(() => api<any[]>('/me/addresses'), []);
  const consents = useLoad(() => api<any[]>('/me/consents'), []);
  const notes = useLoad(() => api<any>('/notifications'), [tick]);
  const [profileName, setProfileName] = useState('');
  const [prefs, setPrefs] = useState<{
    diet: string[];
    allergens: string[];
    exclude: string[];
    tier: string;
    substitutionPolicy: string;
  }>({ diet: [], allergens: [], exclude: [], tier: 'any', substitutionPolicy: 'ask' });
  const [addr, setAddr] = useState({ areaId: '', building: '', unit: '', label: 'Home' });
  const [error, setError] = useState<unknown>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [delText, setDelText] = useState('');
  useEffect(() => {
    if (me.data) {
      setProfileName(me.data.name ?? '');
      setPrefs((p) => ({ ...p, ...(me.data.preferences ?? {}) }));
    }
  }, [me.data]);
  const wrap = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const consent = (kind: string) => !!consents.data?.find((c) => c.kind === kind)?.granted;
  const setConsent = (kind: string, granted: boolean) =>
    wrap(async () => {
      await api('/me/consents', { method: 'PUT', body: { kind, granted } });
      await consents.reload();
    });
  if (!user) return null;
  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('profile.title')}</h1>
        <div className="row">
          <Link className="btn ghost small" to="/saved">
            {t('nav.saved')}
          </Link>
          <Link className="btn ghost small" to="/loyalty">
            {t('nav.loyalty')}
          </Link>
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              logout();
              nav('/');
            }}
          >
            {t('nav.signout')}
          </Button>
        </div>
      </div>
      <ErrorBox error={error} />
      <Card className="stack">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            wrap(async () => {
              await api('/me', { method: 'PATCH', body: { name: profileName } });
              toast(t('profile.saved'));
            });
          }}
        >
          <TextInput label={t('common.name')} value={profileName} onChange={setProfileName} />
          <div className="small muted">{user.phone}</div>
          <div>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
        <div className="field">
          <span className="label">{t('profile.language')}</span>
          <Chips
            value={locale}
            onChange={(l: 'ar' | 'en') => {
              setLocale(l);
              api('/me', { method: 'PATCH', body: { locale: l } }).catch(() => undefined);
            }}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
      </Card>
      <Card className="stack">
        <h2>{t('profile.addresses')}</h2>
        {(addrs.data ?? []).map((a) => (
          <div key={a.id} className="row between">
            <span>
              {a.label} · {a.building}
              {a.unit ? ` ${a.unit}` : ''} · {name({ en: a.area_name_en, ar: a.area_name_ar })}
            </span>
            <Button
              size="small"
              variant="ghost"
              onClick={() =>
                wrap(async () => {
                  await api(`/me/addresses/${a.id}`, { method: 'DELETE' });
                  addrs.reload();
                })
              }
            >
              {t('common.delete')}
            </Button>
          </div>
        ))}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            wrap(async () => {
              await api('/me/addresses', { body: { ...addr, unit: addr.unit || null } });
              setAddr({ areaId: '', building: '', unit: '', label: 'Home' });
              addrs.reload();
            });
          }}
        >
          <Field label={t('builder.area')}>
            {(a) => (
              <select
                {...a}
                className="input"
                value={addr.areaId}
                onChange={(e) => setAddr({ ...addr, areaId: e.target.value })}
                required
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
            value={addr.building}
            onChange={(v) => setAddr({ ...addr, building: v })}
            required
          />
          <TextInput
            label={t('checkout.address.unit')}
            value={addr.unit}
            onChange={(v) => setAddr({ ...addr, unit: v })}
          />
          <div>
            <Button type="submit" variant="secondary">
              {t('profile.addresses.add')}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="stack">
        <h2>{t('profile.prefs')}</h2>
        <p className="hint">{t('profile.prefs.sub')}</p>
        <div className="field">
          <span className="label">{t('builder.diet')}</span>
          <Chips
            multi
            value={prefs.diet}
            onChange={(v: string[]) => setPrefs({ ...prefs, diet: v })}
            options={DIETS.map((x) => ({ value: x, label: t(`diet.${x}` as Key) }))}
          />
        </div>
        <div className="field">
          <span className="label">{t('builder.allergens')}</span>
          <Chips
            multi
            value={prefs.allergens}
            onChange={(v: string[]) => setPrefs({ ...prefs, allergens: v })}
            options={ALLERGENS.map((x) => ({ value: x, label: t(`allergen.${x}` as Key) }))}
          />
        </div>
        <div className="field">
          <span className="label">{t('builder.subst')}</span>
          <Chips
            value={prefs.substitutionPolicy}
            onChange={(v: string) => setPrefs({ ...prefs, substitutionPolicy: v })}
            options={['ask', 'auto', 'none'].map((x) => ({
              value: x,
              label: t(`builder.subst.${x}` as Key),
            }))}
          />
        </div>
        <div>
          <Button
            onClick={() =>
              wrap(async () => {
                await api('/me', { method: 'PATCH', body: { preferences: prefs } });
                setForm((f) => ({
                  ...f,
                  diet: prefs.diet,
                  allergens: prefs.allergens,
                  substitutionPolicy: prefs.substitutionPolicy as any,
                }));
                toast(t('profile.saved'));
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>
      <Card className="stack">
        <h2>{t('profile.privacy')}</h2>
        {(['location', 'transcription', 'marketing', 'personalization'] as const).map((k) => (
          <label key={k} className="row">
            <input
              type="checkbox"
              checked={consent(k)}
              onChange={(e) => setConsent(k, e.target.checked)}
              style={{ width: 22, height: 22 }}
            />{' '}
            {t(`profile.consent.${k}` as Key)}
          </label>
        ))}
        <p className="hint">{t('profile.retention')}</p>
        <div className="row">
          <Button
            variant="secondary"
            onClick={() =>
              wrap(async () => {
                const r = await api('/me/export', { body: {} });
                const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
                setExportUrl(URL.createObjectURL(blob));
              })
            }
          >
            {t('profile.export')}
          </Button>
          {exportUrl && (
            <a className="btn small" href={exportUrl} download="yalasala-my-data.json">
              {t('profile.export.ok')} ⬇
            </a>
          )}
        </div>
      </Card>
      <Card className="stack">
        <h2>{t('profile.notifications')}</h2>
        {!notes.data?.items.length ? (
          <p className="muted">{t('profile.notifications.empty')}</p>
        ) : (
          <ul className="facts">
            {notes.data.items.slice(0, 10).map((n: any) => (
              <li key={n.id}>
                {(n.kind && t(`notif.${n.kind}` as Key, { ...n.payload } as any)) || t('notif.unknown')}{' '}
                <span className="small muted">{date(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {notes.data?.unread > 0 && (
          <div>
            <Button
              size="small"
              variant="ghost"
              onClick={async () => {
                await api('/notifications/read', { body: {} });
                notes.reload();
              }}
            >
              {t('common.done')}
            </Button>
          </div>
        )}
      </Card>
      <Card className="stack">
        <h2>{t('profile.delete')}</h2>
        <Alert tone="warn">{t('profile.delete.confirm')}</Alert>
        <TextInput label="DELETE" value={delText} onChange={setDelText} dir="ltr" />
        <div>
          <Button
            variant="danger"
            disabled={delText !== 'DELETE'}
            onClick={() =>
              wrap(async () => {
                await api('/me/delete', { body: { confirm: 'DELETE' } });
                logout();
                toast(t('profile.delete.done'));
                nav('/');
              })
            }
          >
            {t('profile.delete')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function HelpPage() {
  const { t } = useI18n();
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1>{t('help.title')}</h1>
      <Card>
        <h2>{t('help.contact')}</h2>
        <p>{t('help.contact_body')}</p>
      </Card>
      <Card>
        <h2>{t('help.dispute')}</h2>
        <p>{t('help.dispute_body')}</p>
        <Link to="/orders">{t('nav.orders')} →</Link>
      </Card>
      <Card>
        <h2>{t('help.report')}</h2>
        <p>
          {t('chat.report.reason')} → {t('nav.messages')}
        </p>
      </Card>
      <section className="faq">
        <h2>{t('faq.title')}</h2>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <details key={n}>
            <summary>{t(`faq.q${n}` as Key)}</summary>
            <p>{t(`faq.a${n}` as Key)}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
export function LegalPage() {
  const { kind } = useParams();
  const { t } = useI18n();
  const terms = kind !== 'privacy';
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1>{terms ? t('legal.terms') : t('legal.privacy')}</h1>
      <Alert tone="warn">{t('footer.legal')}</Alert>
      <p>{terms ? t('legal.terms_body') : t('legal.privacy_body')}</p>
    </div>
  );
}
