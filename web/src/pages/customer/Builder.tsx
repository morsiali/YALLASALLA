import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { toApiConstraints, type Constraints } from '../../lib/types';
import { useApp } from '../../state/app';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import {
  Alert,
  Button,
  Card,
  Chips,
  ErrorBox,
  Field,
  Segmented,
  Stepper,
  TextInput,
  Spinner,
} from '../../components/ui';

const DIETS = ['halal', 'vegetarian', 'gluten_free', 'organic', 'high_protein', 'low_sugar'];
const ALLERGENS = ['nuts', 'dairy', 'gluten', 'eggs', 'soy', 'fish'];
const TYPES = ['custom', 'family_weekly', 'budget', 'single', 'monthly', 'baby', 'healthy'];

/** Calls the generator and stores the basket draft. Shared by builder, ready-basket customisation and recovery options. */
export async function generateBasket(
  form: Constraints,
  source: string,
  fallbackUsed: boolean,
  setBasket: ReturnType<typeof useApp>['setBasket'],
) {
  const hasBudget = form.budgetMinor != null;
  const r = await api('/baskets/generate', {
    body: {
      constraints: toApiConstraints(form),
      source,
      budgetScopeConfirmed: hasBudget ? form.scopeConfirmed : undefined,
      fallbackUsed,
    },
  });
  const items = r.lines.map((l: any) => ({ productId: l.productId, qty: l.qty }));
  setBasket({
    storeId: r.store.id,
    generationId: r.generationId,
    source,
    store: r.store,
    items,
    original: items,
    facts: r.facts,
    health: r.health,
    compared: r.compared,
    recovery: r.recovery,
    reasons: Object.fromEntries(r.lines.map((l: any) => [l.productId, l.reason])),
  });
  return r;
}

export default function Builder() {
  const { t, name, locale } = useI18n();
  const { form, setForm, basket, setBasket, clearBasket } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const mode = sp.get('mode') === 'natural' ? 'natural' : 'guided';
  const [step, setStep] = useState(1);
  const total = 5;
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<any>(null);
  const [voice, setVoice] = useState(false);
  const [excludeText, setExcludeText] = useState('');
  const [budgetText, setBudgetText] = useState(
    form.budgetMinor != null ? String(form.budgetMinor / 100) : '',
  );
  const set = <K extends keyof Constraints>(k: K, v: Constraints[K]) => setForm((f) => ({ ...f, [k]: v }));

  // a voice transcript sent from the conversation screen arrives here via sessionStorage
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('yalasala.nl');
      if (v) {
        sessionStorage.removeItem('yalasala.nl');
        setText(v);
        setVoice(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (voice && text) interpret();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % 3), 1400);
    return () => clearInterval(id);
  }, [busy]);

  const setBudget = (v: string) => {
    setBudgetText(v);
    const n = parseFloat(v.replace(/,/g, ''));
    setForm((f) => ({
      ...f,
      budgetMinor: v.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100),
      scopeConfirmed: v.trim() === '' ? f.scopeConfirmed : f.scopeConfirmed,
    }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.areaId) e.area = t('builder.error.area');
    if (form.budgetMinor != null && !form.scopeConfirmed) e.scope = t('builder.error.scope');
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const build = async (source: string, fallbackUsed = false) => {
    if (!validate()) {
      if (!form.areaId) setStep(1);
      else setStep(3);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await generateBasket(form, source, fallbackUsed, setBasket);
      nav('/basket');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const interpret = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/baskets/parse', { body: { text, source: voice ? 'voice' : 'natural' } });
      setParsed(r);
      setForm((f) => ({
        ...f,
        ...r.constraints,
        scopeConfirmed:
          !r.needsConfirmation.includes('budgetIncludesDelivery') && r.constraints.budgetMinor != null,
        areaId: r.constraints.areaId ?? f.areaId,
      }));
      setBudgetText(r.constraints.budgetMinor != null ? String(r.constraints.budgetMinor / 100) : '');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const unsupported =
    error instanceof ApiError && error.code === 'UNSUPPORTED_AREA'
      ? (error.details?.servedAreas as any[] | undefined)
      : null;

  if ((busy && mode === 'guided') || (busy && parsed)) {
    const msgs = [t('builder.generating'), t('builder.generating2'), t('builder.generating3')];
    return (
      <div
        className="stack"
        style={{ textAlign: 'center', padding: '48px 0' }}
        role="status"
        aria-live="polite"
      >
        <Spinner />
        <h2>{msgs[msgIdx]}</h2>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 760, marginInline: 'auto' }}>
      <h1>{t('builder.title')}</h1>
      {basket && basket.items.length > 0 && (
        <Alert tone="info" title={t('builder.restore')}>
          <div className="row">
            <Link className="btn small" to="/basket">
              {t('builder.continue')}
            </Link>
            <Button size="small" variant="ghost" onClick={clearBasket}>
              {t('builder.discard')}
            </Button>
          </div>
        </Alert>
      )}
      <Segmented
        value={mode}
        onChange={(m) => setSp(m === 'natural' ? { mode: 'natural' } : {})}
        label={t('builder.title')}
        options={[
          { value: 'guided', label: t('builder.tab.guided') },
          { value: 'natural', label: t('builder.tab.natural') },
        ]}
      />

      {unsupported && (
        <Alert tone="warn" title={t('error.UNSUPPORTED_AREA')}>
          <div className="chips" style={{ marginTop: 8 }}>
            {unsupported.map((a) => (
              <button
                key={a.id}
                className="chip"
                onClick={() => {
                  set('areaId', a.id);
                  setError(null);
                }}
              >
                {name(a)}
              </button>
            ))}
          </div>
        </Alert>
      )}
      {!unsupported && <ErrorBox error={error} />}

      {mode === 'natural' ? (
        <Card className="stack">
          <h2>{t('builder.natural.title')}</h2>
          <Field label={t('builder.natural.title')}>
            {(a) => (
              <textarea
                {...a}
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('builder.natural.ph')}
              />
            )}
          </Field>
          <p className="hint">{t('builder.natural.voice')}</p>
          <Button onClick={interpret} busy={busy} disabled={text.trim().length < 2}>
            {t('builder.natural.interpret')}
          </Button>
          {parsed && (
            <div className="stack" aria-live="polite">
              <h3>{t('builder.natural.understood')}</h3>
              {parsed.ai?.fallbackUsed && <Alert tone="info">{t('builder.natural.ai_fallback')}</Alert>}
              {parsed.needsConfirmation.length > 0 && (
                <Alert tone="warn">
                  {t('builder.natural.confirm_needed', {
                    fields: parsed.needsConfirmation
                      .map(
                        (f: string) =>
                          ({
                            areaId: t('builder.area'),
                            household: t('builder.household'),
                            days: t('builder.days'),
                            budget: t('builder.budget'),
                            budgetIncludesDelivery: t('builder.budget.scope'),
                          })[f] ?? f,
                      )
                      .join(locale === 'ar' ? '، ' : ', '),
                  })}
                </Alert>
              )}
              <p className="muted">{t('builder.natural.edit')}</p>
              <GuidedFields
                errors={errors}
                budgetText={budgetText}
                setBudget={setBudget}
                excludeText={excludeText}
                setExcludeText={setExcludeText}
                all
              />
              <Button onClick={() => build(voice ? 'voice' : 'natural', !!parsed.ai?.fallbackUsed)}>
                {t('builder.generate')}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="stack">
          <div className="row between">
            <strong>{t('builder.step', { n: step, total })}</strong>
            <progress value={step} max={total} aria-label={t('builder.step', { n: step, total })} />
          </div>
          <GuidedFields
            step={step}
            errors={errors}
            budgetText={budgetText}
            setBudget={setBudget}
            excludeText={excludeText}
            setExcludeText={setExcludeText}
          />
          <div className="row between">
            <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>
              {t('common.back')}
            </Button>
            {step < total ? (
              <div className="row">
                {step >= 3 && (
                  <Button variant="secondary" onClick={() => build('guided')}>
                    {t('builder.generate')}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (step === 1 && !form.areaId) {
                      setErrors({ area: t('builder.error.area') });
                      return;
                    }
                    if (step === 3 && form.budgetMinor != null && !form.scopeConfirmed) {
                      setErrors({ scope: t('builder.error.scope') });
                      return;
                    }
                    setErrors({});
                    setStep(step + 1);
                  }}
                >
                  {t('common.next')}
                </Button>
              </div>
            ) : (
              <Button onClick={() => build('guided')}>{t('builder.generate')}</Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function GuidedFields({
  step,
  errors,
  budgetText,
  setBudget,
  excludeText,
  setExcludeText,
  all,
}: {
  step?: number;
  errors: Record<string, string>;
  budgetText: string;
  setBudget: (v: string) => void;
  excludeText: string;
  setExcludeText: (v: string) => void;
  all?: boolean;
}) {
  const { t, name, days } = useI18n();
  const { form, setForm, areas } = useApp();
  const set = <K extends keyof Constraints>(k: K, v: Constraints[K]) => setForm((f) => ({ ...f, [k]: v }));
  const show = (n: number) => all || step === n;
  return (
    <>
      {show(1) && (
        <div className="stack">
          <h2>{t('builder.area')}</h2>
          <div className="chips" role="radiogroup" aria-label={t('builder.area')}>
            {areas.map((a) => (
              <button
                type="button"
                key={a.id}
                role="radio"
                aria-checked={form.areaId === a.id}
                className="chip"
                onClick={() => set('areaId', a.id)}
              >
                {name(a)}
                {!a.served ? ` · ${t('area.not_served')}` : ''}
              </button>
            ))}
          </div>
          {errors.area && (
            <div className="err-text" role="alert">
              {errors.area}
            </div>
          )}
          <p className="hint">{t('area.pilot')}</p>
        </div>
      )}
      {show(2) && (
        <div className="stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{t('builder.household')}</h2>
            <Stepper
              value={form.household}
              min={1}
              max={12}
              onChange={(v) => set('household', v)}
              label={t('builder.household')}
            />
          </div>
          <div className="stack">
            <span className="label">{t('builder.days')}</span>
            <Chips
              value={[String(form.days)]}
              onChange={(v: string) => set('days', Number(v))}
              label={t('builder.days')}
              options={[
                { value: '3', label: days(3) },
                { value: '7', label: t('builder.days.7') },
                { value: '14', label: t('builder.days.14') },
                { value: '30', label: t('builder.days.30') },
              ]}
            />
            <div className="row">
              <span className="small muted">{t('builder.days.custom')}:</span>
              <Stepper
                value={form.days}
                min={1}
                max={62}
                onChange={(v) => set('days', v)}
                label={t('builder.days')}
              />
            </div>
          </div>
        </div>
      )}
      {show(3) && (
        <div className="stack">
          <TextInput
            label={t('builder.budget')}
            hint={t('builder.budget.hint')}
            value={budgetText}
            onChange={setBudget}
            inputMode="decimal"
            error={null}
          />
          {form.budgetMinor != null && (
            <div className="stack" role="group" aria-labelledby="scope-l">
              <span id="scope-l" className="label">
                {t('builder.budget.scope')}
              </span>
              <Chips
                value={form.scopeConfirmed ? (form.budgetIncludesDelivery ? 'incl' : 'excl') : ''}
                onChange={(v: string) =>
                  setForm((f) => ({ ...f, budgetIncludesDelivery: v === 'incl', scopeConfirmed: true }))
                }
                label={t('builder.budget.scope')}
                options={[
                  { value: 'incl', label: t('builder.budget.incl') },
                  { value: 'excl', label: t('builder.budget.excl') },
                ]}
              />
              {errors.scope && (
                <div className="err-text" role="alert">
                  {errors.scope}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {show(4) && (
        <div className="stack">
          <div className="field">
            <span className="label">{t('builder.type')}</span>
            <Chips
              value={form.basketType}
              onChange={(v: string) =>
                setForm((f) => ({
                  ...f,
                  basketType: v,
                  baby: v === 'baby' ? true : f.baby && v !== 'baby' ? false : f.baby,
                  includeOptional: v === 'healthy' || v === 'budget' ? false : f.includeOptional,
                  tier: v === 'budget' ? 'value' : f.tier,
                }))
              }
              label={t('builder.type')}
              options={TYPES.map((x) => ({ value: x, label: t(`builder.type.${x}` as Key) }))}
            />
          </div>
          <div className="field">
            <span className="label">{t('builder.diet')}</span>
            <Chips
              multi
              value={form.diet}
              onChange={(v: string[]) => set('diet', v)}
              label={t('builder.diet')}
              options={DIETS.map((x) => ({ value: x, label: t(`diet.${x}` as Key) }))}
            />
          </div>
          <div className="field">
            <span className="label">{t('builder.allergens')}</span>
            <Chips
              multi
              value={form.allergens}
              onChange={(v: string[]) => set('allergens', v)}
              label={t('builder.allergens')}
              options={ALLERGENS.map((x) => ({ value: x, label: t(`allergen.${x}` as Key) }))}
            />
          </div>
          <div className="field">
            <span className="label">{t('builder.tier')}</span>
            <Chips
              value={form.tier}
              onChange={(v: string) => set('tier', v)}
              label={t('builder.tier')}
              options={['any', 'value', 'standard', 'premium'].map((x) => ({
                value: x,
                label: t(`builder.tier.${x}` as Key),
              }))}
            />
          </div>
        </div>
      )}
      {show(5) && (
        <div className="stack">
          <div className="field">
            <span className="label">{t('builder.exclude')}</span>
            <div className="row">
              <input
                className="input grow"
                value={excludeText}
                placeholder={t('builder.exclude.ph')}
                aria-label={t('builder.exclude')}
                onChange={(e) => setExcludeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && excludeText.trim()) {
                    e.preventDefault();
                    set('exclude', [...new Set([...form.exclude, excludeText.trim()])]);
                    setExcludeText('');
                  }
                }}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (excludeText.trim()) {
                    set('exclude', [...new Set([...form.exclude, excludeText.trim()])]);
                    setExcludeText('');
                  }
                }}
              >
                {t('common.add')}
              </Button>
            </div>
            <div className="chips">
              {form.exclude.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="chip"
                  aria-pressed
                  onClick={() =>
                    set(
                      'exclude',
                      form.exclude.filter((y) => y !== x),
                    )
                  }
                >
                  {x} ✕
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">{t('builder.subst')}</span>
            <Chips
              value={form.substitutionPolicy}
              onChange={(v: any) => set('substitutionPolicy', v)}
              label={t('builder.subst')}
              options={['ask', 'auto', 'none'].map((x) => ({
                value: x,
                label: t(`builder.subst.${x}` as Key),
              }))}
            />
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={form.includeOptional}
              onChange={(e) => set('includeOptional', e.target.checked)}
              style={{ width: 22, height: 22 }}
            />{' '}
            {t('builder.optional')}
          </label>
        </div>
      )}
    </>
  );
}
