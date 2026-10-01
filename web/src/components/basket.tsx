import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import {
  toApiConstraints,
  type BudgetStatus,
  type Constraints,
  type Fact,
  type Health,
  type Line,
  type Priced,
  type Totals,
} from '../lib/types';
import { factText, useCategories } from '../lib/facts';
import { useI18n } from '../i18n';
import type { Key } from '../i18n/en';
import { Alert, Badge, Button, ErrorBox, Modal, Money, SkeletonList, Stepper, useLoad } from './ui';

const GROUPS = [
  'essentials',
  'breakfast_dairy',
  'protein',
  'fruits_veg',
  'beverages',
  'cleaning',
  'personal_care',
  'baby_family',
  'optional',
];

export function budgetMessage(
  b: BudgetStatus,
  t: ReturnType<typeof useI18n>['t'],
  money: (n: number) => string,
): string {
  if (b.state === 'none') return t('budget.none');
  const amount = money(b.state === 'over' ? b.overByMinor : (b.remainingMinor ?? 0));
  return t(`budget.${b.state}.${b.scope}` as Key, { amount });
}
const tone = (s: BudgetStatus['state']) =>
  (s === 'within' ? 'ok' : s === 'close' ? 'warn' : s === 'over' ? 'bad' : 'info') as
    'ok' | 'warn' | 'bad' | 'info';

/** Always-visible totals. aria-live so screen readers hear budget changes while editing. */
export function BudgetSummary({
  totals,
  budget,
  pricing,
  store,
}: {
  totals: Totals;
  budget: BudgetStatus;
  pricing?: boolean;
  store?: string;
}) {
  const { t, money } = useI18n();
  return (
    <section className="budgetbar" aria-label={t('basket.total')}>
      <div className="row between">
        <div>
          <div className="small muted">
            {t('basket.total')}
            {store ? ` · ${store}` : ''}
          </div>
          <div className="total">
            <Money minor={totals.totalMinor} />
          </div>
        </div>
        <Badge
          tone={tone(budget.state)}
          icon={
            budget.state === 'within'
              ? '✓'
              : budget.state === 'close'
                ? '!'
                : budget.state === 'over'
                  ? '✕'
                  : 'i'
          }
        >
          {t(`budget.${budget.state}` as Key)}
        </Badge>
      </div>
      <dl>
        <dt>{t('basket.subtotal')}</dt>
        <dd>
          <Money minor={totals.subtotalMinor} />
        </dd>
        <dt>{t('basket.delivery')}</dt>
        <dd>
          {totals.deliveryFeeMinor === 0 ? (
            t('basket.delivery.free')
          ) : (
            <Money minor={totals.deliveryFeeMinor} />
          )}
        </dd>
        {totals.loyaltyMinor > 0 && (
          <>
            <dt>{t('basket.loyalty')}</dt>
            <dd>
              −<Money minor={totals.loyaltyMinor} />
            </dd>
          </>
        )}
        {budget.budgetMinor != null && (
          <>
            <dt>
              {t('basket.budget')} ({t(`budget.scope.${budget.scope}_short` as Key)})
            </dt>
            <dd>
              <Money minor={budget.budgetMinor} />
            </dd>
          </>
        )}
      </dl>
      <p aria-live="polite" className="small strong" style={{ margin: '8px 0 0' }}>
        {pricing ? t('basket.reprice') : budgetMessage(budget, t, money)}
      </p>
    </section>
  );
}

export function AvailabilityBadge({ a }: { a: Line['availability'] }) {
  const { t } = useI18n();
  return a === 'in_stock' ? (
    <Badge tone="ok">{t('item.in_stock')}</Badge>
  ) : a === 'limited' ? (
    <Badge tone="warn">{t('item.limited')}</Badge>
  ) : (
    <Badge tone="bad">{t('item.unavailable')}</Badge>
  );
}

export function LineRow({
  line,
  onQty,
  onReplace,
  onRemove,
  readonly,
  storeName,
  hideReason,
}: {
  line: Line;
  onQty?: (q: number) => void;
  onReplace?: () => void;
  onRemove?: () => void;
  readonly?: boolean;
  storeName?: string;
  hideReason?: boolean;
}) {
  const { t, name } = useI18n();
  const reason = t(`item.reason.${line.reason}` as Key);
  return (
    <div className={`line ${line.availability === 'unavailable' ? 'gone' : ''}`}>
      <img
        className="thumb"
        src={line.imageUrl ?? '/img/store-cover.svg'}
        alt=""
        loading="lazy"
        width={64}
        height={64}
      />
      <div>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="strong">{name(line.name)}</div>
            <div className="small muted">
              {line.brand} · {line.sizeLabel}
              {storeName ? ` · ${storeName}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="strong">
              <Money minor={line.lineTotalMinor} />
            </div>
            <div className="small muted">
              <Money minor={line.unitPriceMinor} /> × <span className="num">{line.qty}</span>
            </div>
          </div>
        </div>
        <div className="row small" style={{ marginTop: 4 }}>
          <AvailabilityBadge a={line.availability} />
          {line.compareAtMinor ? (
            <Badge tone="ok" icon="%">
              {t('item.offer')}{' '}
              <span className="price-was">
                <Money minor={line.compareAtMinor} />
              </span>
            </Badge>
          ) : null}
          {!hideReason && <span className="muted">{reason}</span>}
        </div>
        {!readonly && (
          <div className="controls">
            <Stepper
              value={line.qty}
              min={0}
              onChange={(q) => onQty?.(q)}
              label={`${t('item.qty')}: ${name(line.name)}`}
            />
            {onReplace && (
              <Button size="small" variant="secondary" onClick={onReplace}>
                {t('item.replace')}
              </Button>
            )}
            {onRemove && (
              <Button size="small" variant="ghost" onClick={onRemove}>
                {t('item.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BasketEditor({
  priced,
  onQty,
  onReplace,
  constraints,
  readonly,
}: {
  priced: Priced;
  onQty: (id: string, q: number) => void;
  onReplace: (from: string, to: string) => void;
  constraints: Constraints;
  readonly?: boolean;
}) {
  const { t, name, money } = useI18n();
  const cats = useCategories();
  const [alt, setAlt] = useState<Line | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Line | null>(null);
  const grouped = GROUPS.map((g) => ({ g, lines: priced.lines.filter((l) => l.needGroup === g) })).filter(
    (x) => x.lines.length,
  );
  const remove = (l: Line) => (l.priority === 'essential' ? setConfirmRemove(l) : onQty(l.productId, 0));
  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      {priced.unavailable.length > 0 && <Alert tone="warn">{t('basket.unavailable')}</Alert>}
      {priced.dropped > 0 && <Alert tone="warn">{t('basket.dropped')}</Alert>}
      {priced.totals.belowMinOrder && (
        <Alert tone="warn">{t('basket.min_order', { amount: money(priced.totals.minOrderMinor) })}</Alert>
      )}
      {grouped.map(({ g, lines }) => (
        <section key={g} aria-labelledby={`g-${g}`}>
          <h3 id={`g-${g}`}>{t(`group.${g}` as Key)}</h3>
          <div className="card flat">
            {lines.map((l) => (
              <LineRow
                key={l.productId}
                line={l}
                readonly={readonly}
                onQty={(q) => (q <= 0 ? remove(l) : onQty(l.productId, q))}
                onReplace={() => setAlt(l)}
                onRemove={() => remove(l)}
              />
            ))}
          </div>
        </section>
      ))}
      {alt && (
        <AlternativesModal
          line={alt}
          constraints={constraints}
          onClose={() => setAlt(null)}
          onPick={(to) => {
            onReplace(alt.productId, to);
            setAlt(null);
          }}
        />
      )}
      {confirmRemove && (
        <Modal title={t('item.remove')} onClose={() => setConfirmRemove(null)}>
          <Alert tone="warn">
            {t('basket.essential_warn', {
              items:
                name(confirmRemove.name) +
                ` (${(cats[confirmRemove.categoryCode] && name({ en: cats[confirmRemove.categoryCode].name_en, ar: cats[confirmRemove.categoryCode].name_ar })) || confirmRemove.categoryCode})`,
            })}
          </Alert>
          <div className="row">
            <Button
              variant="danger"
              onClick={() => {
                onQty(confirmRemove.productId, 0);
                setConfirmRemove(null);
              }}
            >
              {t('item.remove')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface Alt extends Line {
  kind: 'save_more' | 'similar_price' | 'higher_price';
  priceDiffMinor: number;
  mappedByStore: boolean;
  differences: { field: string; from: string; to: string }[];
}
export function AlternativesModal({
  line,
  constraints,
  onClose,
  onPick,
}: {
  line: Line;
  constraints: Constraints;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { t, name, money } = useI18n();
  const c = toApiConstraints(constraints);
  const qs = new URLSearchParams({
    qty: String(line.qty),
    diet: c.diet.join(','),
    allergens: c.allergens.join(','),
    exclude: c.exclude.join(','),
  });
  const { data, loading, error, reload } = useLoad(
    () => api<{ alternatives: Alt[] }>(`/products/${line.productId}/alternatives?${qs}`),
    [line.productId, line.qty],
  );
  const order: Alt['kind'][] = ['save_more', 'similar_price', 'higher_price'];
  return (
    <Modal title={t('alt.title', { name: name(line.name) })} onClose={onClose}>
      {loading ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.alternatives.length ? (
        <Alert tone="info">{t('alt.none')}</Alert>
      ) : (
        order.map((k) => {
          const items = data.alternatives.filter((a) => a.kind === k);
          if (!items.length) return null;
          return (
            <section key={k}>
              <h3>{t(`alt.${k}` as Key)}</h3>
              <div className="stack">
                {items.map((a) => (
                  <div key={a.productId} className="card flat">
                    <div className="row">
                      <img className="thumb sm" src={a.imageUrl ?? ''} alt="" width={52} height={52} />
                      <div className="grow">
                        <div className="strong">{name(a.name)}</div>
                        <div className="small muted">
                          {a.brand} · {a.sizeLabel} · <Money minor={a.unitPriceMinor} />
                        </div>
                      </div>
                    </div>
                    <p className="strong" style={{ margin: '8px 0 4px' }}>
                      {t('alt.effect')}:{' '}
                      {a.priceDiffMinor === 0
                        ? t('alt.same')
                        : a.priceDiffMinor < 0
                          ? t('alt.cheaper', { amount: money(-a.priceDiffMinor) })
                          : t('alt.dearer', { amount: money(a.priceDiffMinor) })}
                    </p>
                    <ul className="small muted facts">
                      {a.differences.map((d, i) => (
                        <li key={i}>
                          {t(`alt.diff.${d.field}` as Key, {
                            from:
                              d.field === 'dietary_lost'
                                ? d.from
                                    .split(',')
                                    .map((x) => t(`diet.${x}` as Key))
                                    .join(', ')
                                : d.from,
                            to: d.to,
                          })}
                        </li>
                      ))}
                    </ul>
                    <div className="row">
                      {a.mappedByStore && <Badge tone="info">{t('alt.mapped')}</Badge>}
                      <Button size="small" onClick={() => onPick(a.productId)}>
                        {t('alt.use')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </Modal>
  );
}

export function WhyPanel({
  facts,
  health,
  priced,
}: {
  facts: Fact[];
  health: Health | null;
  priced: Priced | null;
}) {
  const { t, locale, money, people, days } = useI18n();
  const cats = useCategories();
  const budget = priced?.budget;
  return (
    <section aria-labelledby="why-h" className="card">
      <h2 id="why-h">{t('why.title')}</h2>
      <ul className="facts">
        {facts.map((f, i) => {
          const s = factText(f, { t, money, locale, cats, people, days });
          return s ? <li key={i}>{s}</li> : null;
        })}
      </ul>
      {health && (
        <>
          <h3 style={{ marginTop: 16 }}>{t('why.health')}</h3>
          <div className="health">
            <div>
              <div className="k">{t('why.health.budget')}</div>
              {budget ? <div className="strong">{budgetMessage(budget, t, money)}</div> : '—'}
            </div>
            <div>
              <div className="k">{t('why.health.essentials')}</div>
              <div className="strong">
                {t('why.health.essentials_v', {
                  covered: health.essentialsCovered,
                  total: health.essentialsTotal,
                })}
              </div>
            </div>
            <div>
              <div className="k">{t('why.health.availability')}</div>
              <div className="strong">
                {t('why.health.availability_v', { n: health.itemsInStock, total: health.itemsTotal })}
              </div>
            </div>
            <div>
              <div className="k">{t('why.health.savings')}</div>
              <div className="strong">
                {health.savingsMinor > 0
                  ? t('why.health.savings_v', {
                      n: facts.find((f) => f.code === 'savings_from_alternatives')?.params.count ?? '',
                      amount: money(health.savingsMinor),
                    })
                  : t('why.health.savings_none')}
                {health.offerSavingsMinor > 0
                  ? ` ${t('why.health.offers', { amount: money(health.offerSavingsMinor) })}`
                  : ''}
              </div>
            </div>
            <div>
              <div className="k">{t('why.health.household')}</div>
              <div className="strong">
                {t('why.health.household_v', {
                  household: people(health.household),
                  days: days(health.days),
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function describeError(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}
