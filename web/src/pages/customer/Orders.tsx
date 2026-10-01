import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../state/app';
import { useAuth } from '../../state/auth';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import { defaultConstraints, type Line } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorBox,
  Modal,
  Money,
  SkeletonList,
  TextInput,
  toast,
  useLoad,
} from '../../components/ui';
import { LineRow } from '../../components/basket';

export const TIMELINE = [
  'received',
  'reviewing',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
] as const;
export const statusTone = (s: string) =>
  (s === 'delivered'
    ? 'ok'
    : s === 'cancelled' || s === 'rejected'
      ? 'bad'
      : s === 'pending_payment'
        ? 'warn'
        : 'info') as 'ok' | 'bad' | 'warn' | 'info';

export function Timeline({
  status,
  history,
}: {
  status: string;
  history: { to_status: string; created_at: string }[];
}) {
  const { t, date } = useI18n();
  const idx = TIMELINE.indexOf(status as (typeof TIMELINE)[number]);
  const failed = status === 'cancelled' || status === 'rejected';
  const when = (s: string) => history.find((h) => h.to_status === s)?.created_at;
  return (
    <ol className="timeline" aria-label={t('order.timeline')}>
      {status === 'pending_payment' && (
        <li className="current">
          <span className="dot" aria-hidden>
            …
          </span>
          <div>
            <strong>{t('status.pending_payment')}</strong>
          </div>
        </li>
      )}
      {TIMELINE.map((s, i) => {
        const cls = failed ? (when(s) ? 'done' : '') : i < idx ? 'done' : i === idx ? 'current' : '';
        return (
          <li key={s} className={cls} aria-current={cls === 'current' ? 'step' : undefined}>
            <span className="dot" aria-hidden>
              {cls === 'done' ? '✓' : i + 1}
            </span>
            <div>
              <strong>{t(`status.${s}` as Key)}</strong>
              {when(s) && <div className="small muted">{date(when(s)!)}</div>}
            </div>
          </li>
        );
      })}
      {failed && (
        <li className="bad">
          <span className="dot" aria-hidden>
            ✕
          </span>
          <div>
            <strong>{t(`status.${status}` as Key)}</strong>
            {when(status) && <div className="small muted">{date(when(status)!)}</div>}
          </div>
        </li>
      )}
    </ol>
  );
}

export function OrdersList() {
  const { t, name, date } = useI18n();
  const { tick } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/orders'), [tick]);
  return (
    <div className="stack">
      <h1>{t('nav.orders')}</h1>
      {loading && !data ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>{t('order.list.empty')}</Card>
      ) : (
        data.map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="card row between"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div>
              <div className="strong">{t('order.title', { no: o.order_no })}</div>
              <div className="small muted">
                {name({ en: o.store_name_en, ar: o.store_name_ar })} · {date(o.placed_at)}
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <Money minor={o.total_minor} />
              <div>
                <Badge tone={statusTone(o.status)}>{t(`status.${o.status}` as Key)}</Badge>
              </div>
              {o.needs_decision && <Badge tone="warn">{t('subst.status.pending')}</Badge>}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

function SubstitutionCard({ s, orderId, onDone }: { s: any; orderId: string; onDone: () => void }) {
  const { t, name, money } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const decide = async (d: 'accept' | 'reject') => {
    setBusy(d);
    setError(null);
    try {
      await api(`/orders/${orderId}/substitutions/${s.id}`, { body: { decision: d } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const pending = s.status === 'pending';
  const none = !s.proposed_product_id;
  return (
    <Card className="stack" aria-label={t('subst.title')}>
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('subst.title')}</h3>
        <Badge tone={pending ? 'warn' : s.status === 'rejected' ? 'bad' : 'ok'}>
          {t(`subst.status.${s.status}` as Key)}
        </Badge>
      </div>
      <div className="grid cols-2">
        <div>
          <div className="label">{t('subst.original')}</div>
          <div>{name({ en: s.orig_name_en, ar: s.orig_name_ar })}</div>
          <div className="small muted">
            {s.orig_brand} · {s.orig_size} · <Money minor={s.orig_unit_price} /> × {s.orig_qty}
          </div>
        </div>
        <div>
          <div className="label">{t('subst.proposed')}</div>
          {none ? (
            <div className="muted">{t('subst.none')}</div>
          ) : (
            <>
              <div>{name({ en: s.proposed_name_en, ar: s.proposed_name_ar })}</div>
              <div className="small muted">
                {s.proposed_brand} · {s.proposed_size} · <Money minor={s.proposed_unit_price} /> ×{' '}
                {s.proposed_qty}
              </div>
            </>
          )}
        </div>
      </div>
      {s.reason && <p className="small muted">{t('subst.reason', { reason: s.reason })}</p>}
      {!none && (
        <>
          <p className="strong" style={{ margin: 0 }}>
            {t('subst.price_diff')}:{' '}
            {s.price_diff_minor === 0
              ? t('alt.same')
              : s.price_diff_minor < 0
                ? t('alt.cheaper', { amount: money(-s.price_diff_minor) })
                : t('alt.dearer', { amount: money(s.price_diff_minor) })}
          </p>
          <ul className="small facts">
            {(s.differences as any[]).map((d, i) => (
              <li key={i}>
                {t(`alt.diff.${d.field}` as Key, {
                  from:
                    d.field === 'dietary_lost'
                      ? d.from
                          .split(',')
                          .map((x: string) => t(`diet.${x}` as Key))
                          .join(', ')
                      : d.from,
                  to: d.to,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {pending && (
        <>
          <Alert tone="info">{t('subst.pending_note')}</Alert>
          <ErrorBox error={error} />
          <div className="row">
            <Button busy={busy === 'accept'} onClick={() => decide('accept')}>
              {none ? t('subst.accept_remove') : t('subst.accept')}
            </Button>
            <Button variant="secondary" busy={busy === 'reject'} onClick={() => decide('reject')}>
              {none ? t('subst.reject_cancel') : t('subst.reject')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export function OrderPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const { t, name, date } = useI18n();
  const nav = useNavigate();
  const { tick } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api<any>(`/orders/${id}`), [id, tick]);
  const [cancelling, setCancelling] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [actionErr, setActionErr] = useState<unknown>(null);
  useEffect(() => {
    const i = setInterval(reload, 15000);
    return () => clearInterval(i);
  }, [reload]);
  if (loading && !data) return <SkeletonList n={4} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { order: o, items, history, substitutions, payments, refunds, disputes } = data;
  const canCancel = ['pending_payment', 'received', 'reviewing'].includes(o.status);
  const openSubs = substitutions.filter((s: any) => s.status === 'pending');
  const cancel = async () => {
    setCancelling(true);
    setActionErr(null);
    try {
      await api(`/orders/${id}/cancel`, { body: {} });
      toast(t('status.cancelled'));
      await reload();
    } catch (e) {
      setActionErr(e);
    } finally {
      setCancelling(false);
    }
  };
  const message = async () => {
    const c = await api('/conversations', { body: { storeId: o.store_id, ref: { type: 'order', id } } });
    nav(`/messages/${c.id}`);
  };
  const dispute = async () => {
    setActionErr(null);
    try {
      await api(`/orders/${id}/dispute`, { body: { reason } });
      setDisputeOpen(false);
      setReason('');
      toast(t('order.dispute.sent'));
      await reload();
    } catch (e) {
      setActionErr(e);
    }
  };
  const statusLabel = (s: string) => t(`status.${s}` as Key);
  return (
    <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      {sp.get('placed') && (
        <Alert tone="ok" title={t('order.thanks')}>
          {t('order.thanks_sub')}
        </Alert>
      )}
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('order.title', { no: o.order_no })}</h1>
        <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
      </div>
      <div className="small muted">
        {name({ en: o.store_name_en, ar: o.store_name_ar })} · {date(o.placed_at)} ·{' '}
        {t('stores.eta', { min: o.eta_min_minutes, max: o.eta_max_minutes })}
      </div>
      {openSubs.map((s: any) => (
        <SubstitutionCard key={s.id} s={s} orderId={id} onDone={reload} />
      ))}
      <div className="layout-2">
        <div className="stack">
          <Card>
            <h2>{t('order.timeline')}</h2>
            <Timeline status={o.status} history={history} />
            <p className="hint">{t('order.no_tracking_map')}</p>
          </Card>
          <Card>
            <h2>{t('order.items')}</h2>
            {(items as any[]).map((i) => {
              const line = {
                productId: i.product_id,
                qty: i.qty,
                name: { en: i.name_en, ar: i.name_ar },
                brand: i.brand,
                sizeLabel: i.size_label,
                imageUrl: i.image_url ?? null,
                unitPriceMinor: i.unit_price_minor,
                lineTotalMinor: i.line_total_minor,
                compareAtMinor: null,
                availability:
                  i.status === 'unavailable' || i.status === 'removed' ? 'unavailable' : 'in_stock',
                reason: i.status === 'substituted' ? 'planned' : 'planned',
              } as unknown as Line;
              return (
                <div key={i.id}>
                  <LineRow line={line} readonly hideReason />
                  {i.status !== 'ok' && (
                    <div className="small">
                      <Badge tone={i.status === 'substituted' ? 'info' : 'bad'}>
                        {i.status === 'removed'
                          ? t('subst.removed_note')
                          : i.status === 'substituted'
                            ? t('item.substituted')
                            : t('item.unavailable')}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
          {substitutions.filter((s: any) => s.status !== 'pending').length > 0 && (
            <Card>
              <h2>{t('subst.history')}</h2>
              <div className="stack">
                {substitutions
                  .filter((s: any) => s.status !== 'pending')
                  .map((s: any) => (
                    <div key={s.id} className="small">
                      {name({ en: s.orig_name_en, ar: s.orig_name_ar })} →{' '}
                      {s.proposed_name_en
                        ? name({ en: s.proposed_name_en, ar: s.proposed_name_ar })
                        : t('subst.none')}{' '}
                      ·{' '}
                      <Badge tone={s.status === 'rejected' ? 'bad' : 'ok'}>
                        {t(`subst.status.${s.status}` as Key)}
                      </Badge>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
        <aside className="stack">
          <Card>
            <dl
              className="budgetbar"
              style={{ position: 'static', border: 0, boxShadow: 'none', padding: 0 }}
            >
              <dl>
                <dt>{t('basket.subtotal')}</dt>
                <dd>
                  <Money minor={o.subtotal_minor} />
                </dd>
                <dt>{t('basket.delivery')}</dt>
                <dd>
                  {o.delivery_fee_minor === 0 ? (
                    t('basket.delivery.free')
                  ) : (
                    <Money minor={o.delivery_fee_minor} />
                  )}
                </dd>
                {o.loyalty_redeemed_minor > 0 && (
                  <>
                    <dt>{t('basket.loyalty')}</dt>
                    <dd>
                      −<Money minor={o.loyalty_redeemed_minor} />
                    </dd>
                  </>
                )}
                <dt className="strong">{t('basket.total')}</dt>
                <dd className="strong">
                  <Money minor={o.total_minor} />
                </dd>
                {o.budget_minor != null && (
                  <>
                    <dt>{t('basket.budget')}</dt>
                    <dd>
                      <Money minor={o.budget_minor} />{' '}
                      {o.budget_status === 'over_approved' ? (
                        <Badge tone="warn">{t('budget.over')}</Badge>
                      ) : (
                        <Badge tone={o.budget_status === 'close' ? 'warn' : 'ok'}>
                          {t(
                            `budget.${o.budget_status === 'over_approved' ? 'over' : o.budget_status}` as Key,
                          )}
                        </Badge>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </dl>
            <p className="small" style={{ marginTop: 8 }}>
              {t('order.payment')}:{' '}
              {t(`order.payment.${o.payment_status === 'pending' ? 'pending' : o.payment_status}` as Key)}{' '}
              {payments[0]?.mode === 'sandbox' && <Badge tone="test">{t('common.sandbox')}</Badge>}
            </p>
            {refunds.length > 0 && (
              <p className="small">
                {t('order.refunds')}:{' '}
                {refunds.map((r: any, i: number) => (
                  <Money key={i} minor={r.amount_minor} />
                ))}
              </p>
            )}
          </Card>
          <Card className="stack">
            <ErrorBox error={actionErr} />
            <Button block onClick={message}>
              💬 {t('order.contact')}
            </Button>
            {canCancel ? (
              <Button
                block
                variant="danger"
                busy={cancelling}
                onClick={() => {
                  if (window.confirm(t('order.cancel_confirm'))) cancel();
                }}
              >
                {t('order.cancel')}
              </Button>
            ) : (
              !['delivered', 'cancelled', 'rejected'].includes(o.status) && (
                <p className="hint">{t('order.cancel_blocked')}</p>
              )
            )}
            {['delivered', 'cancelled', 'rejected'].includes(o.status) && o.status !== 'cancelled' && (
              <Link className="btn secondary block" to={`/orders/${id}/repeat`}>
                {t('order.reorder')}
              </Link>
            )}
            {o.status === 'delivered' && (
              <Link className="btn secondary block" to={`/orders/${id}/repeat`}>
                {t('order.reorder')}
              </Link>
            )}
            <Button block variant="ghost" onClick={() => setDisputeOpen(true)}>
              {t('order.dispute')}
            </Button>
          </Card>
          {disputes.length > 0 && (
            <Card>
              <h3>{t('order.disputes')}</h3>
              {disputes.map((d: any) => (
                <div key={d.id} className="small stack">
                  <div>
                    <Badge tone={d.status === 'resolved' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}>
                      {d.status}
                    </Badge>{' '}
                    {d.reason}
                  </div>
                  {d.resolution && (
                    <div className="muted">
                      {d.resolution}
                      {d.refund_minor ? (
                        <>
                          {' '}
                          · <Money minor={d.refund_minor} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </aside>
      </div>
      {disputeOpen && (
        <Modal title={t('order.dispute')} onClose={() => setDisputeOpen(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              dispute();
            }}
          >
            <TextInput
              label={t('order.dispute.ph')}
              value={reason}
              onChange={setReason}
              minLength={3}
              required
            />
            <ErrorBox error={actionErr} />
            <Button type="submit">{t('order.dispute')}</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function RepeatPage() {
  const { id = '' } = useParams();
  const { t, name, money } = useI18n();
  const nav = useNavigate();
  const { setBasket, setForm, form } = useApp();
  const { data, loading, error, reload } = useLoad(() => api<any>(`/orders/${id}/reorder-preview`), [id]);
  const [useSuggestion, setUseSuggestion] = useState<Record<string, boolean>>({});
  if (loading) return <SkeletonList n={4} />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const go = async () => {
    const st = await api<any>(`/stores/${data.storeId}`);
    const items: { productId: string; qty: number }[] = [];
    for (const l of data.lines as any[]) {
      if (l.status === 'same' || l.status === 'price_changed')
        items.push({ productId: l.productId, qty: l.qty });
      else if (l.suggestion && useSuggestion[l.productId])
        items.push({ productId: l.suggestion.productId, qty: l.qty });
    }
    const c = {
      ...defaultConstraints(),
      ...data.constraints,
      areaId: form.areaId ?? data.constraints.areaId ?? null,
      scopeConfirmed: data.constraints.budgetMinor != null,
    };
    setForm(c);
    setBasket({
      storeId: data.storeId,
      generationId: null,
      source: 'repeat',
      store: {
        id: data.storeId,
        name: { en: st.name_en, ar: st.name_ar },
        deliveryFeeMinor: st.delivery_fee_minor,
        freeDeliveryOverMinor: st.free_delivery_over_minor,
        minOrderMinor: st.min_order_minor,
      },
      items,
      original: items,
      facts: [],
      health: null,
      compared: 1,
      recovery: [],
      reorderOf: id,
    });
    nav('/basket');
  };
  return (
    <div className="stack" style={{ maxWidth: 780 }}>
      <h1>{t('repeat.title')}</h1>
      <p className="muted">{t('repeat.intro', { no: data.previousOrderNo })}</p>
      <Card className="stack">
        {(data.lines as any[]).map((l) => (
          <div
            key={l.productId}
            className="row between"
            style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}
          >
            <div>
              <div className="strong">
                {name(l.name)} × {l.qty}
              </div>
              {l.status === 'price_changed' && (
                <div className="small">
                  {t('repeat.old_new', { old: money(l.oldUnitPriceMinor), new: money(l.newUnitPriceMinor) })}
                </div>
              )}
              {l.suggestion && (
                <label className="small row">
                  <input
                    type="checkbox"
                    checked={!!useSuggestion[l.productId]}
                    onChange={(e) => setUseSuggestion({ ...useSuggestion, [l.productId]: e.target.checked })}
                    style={{ width: 22, height: 22 }}
                  />
                  {t('repeat.suggest', {
                    name: `${name(l.suggestion.name)} (${money(l.suggestion.unitPriceMinor)})`,
                  })}
                </label>
              )}
            </div>
            <Badge tone={l.status === 'same' ? 'ok' : l.status === 'price_changed' ? 'warn' : 'bad'}>
              {t(`repeat.${l.status}` as Key)}
            </Badge>
          </div>
        ))}
      </Card>
      <Card>
        <div>{t('repeat.previous', { amount: money(data.previousTotalMinor) })}</div>
        <div>
          {t('repeat.now', { amount: money(data.totals.totalMinor) })}{' '}
          <span className="small muted">
            ({t('basket.delivery')}:{' '}
            {data.totals.deliveryFeeMinor ? money(data.totals.deliveryFeeMinor) : t('basket.delivery.free')})
          </span>
        </div>
        <div className="strong">
          {t('repeat.diff', {
            amount: `${data.differenceMinor > 0 ? '+' : data.differenceMinor < 0 ? '−' : ''}${money(Math.abs(data.differenceMinor))}`,
          })}
        </div>
      </Card>
      <Button onClick={go}>{t('repeat.continue')}</Button>
    </div>
  );
}
