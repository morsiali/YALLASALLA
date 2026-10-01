import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth, type User } from '../../state/auth';
import { useApp } from '../../state/app';
import { useI18n } from '../../i18n';
import { Alert, Button, Card, Chips, ErrorBox, TextInput } from '../../components/ui';

export function SignIn() {
  const { t, locale, setLocale } = useI18n();
  const { login } = useAuth();
  const { config } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'customer' | 'merchant'>('customer');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const go = (u: User) => {
    if (u.locale !== locale && u.name) setLocale(u.locale);
    const next = sp.get('next');
    nav(
      next && next.startsWith('/')
        ? next
        : u.role === 'merchant'
          ? '/business'
          : u.role === 'admin' || u.role === 'support'
            ? '/admin'
            : '/',
      { replace: true },
    );
  };
  return (
    <div className="stack" style={{ maxWidth: 460, marginInline: 'auto' }}>
      <h1>{t('auth.title')}</h1>
      <Card className="stack">
        {step === 'phone' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/auth/otp/request', { body: { phone } });
                setStep('code');
              });
            }}
            className="stack"
          >
            <TextInput
              label={t('auth.phone')}
              value={phone}
              onChange={setPhone}
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('auth.phone.ph')}
              required
              dir="ltr"
              style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
            />
            <div className="field">
              <span className="label">{t('auth.account_type')}</span>
              <Chips
                options={[
                  { value: 'customer', label: t('auth.customer') },
                  { value: 'merchant', label: t('auth.merchant') },
                ]}
                value={type}
                onChange={setType}
              />
            </div>
            <ErrorBox error={error} />
            <Button type="submit" busy={busy}>
              {t('auth.send')}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await api('/auth/otp/verify', {
                  body: { phone, code, name: name || undefined, accountType: type, locale },
                });
                login(r.token, r.user);
                go(r.user);
              });
            }}
            className="stack"
          >
            {config?.providers.otp.mode !== 'live' && <Alert tone="info">{t('auth.test_note')}</Alert>}
            <TextInput
              label={t('auth.code')}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              dir="ltr"
            />
            <TextInput
              label={`${t('auth.name')} (${t('common.optional')})`}
              value={name}
              onChange={setName}
              autoComplete="name"
            />
            <ErrorBox error={error} />
            <div className="row">
              <Button type="submit" busy={busy}>
                {t('auth.verify')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                  setError(null);
                }}
              >
                {t('auth.resend')}
              </Button>
            </div>
          </form>
        )}
        <p className="hint">{t('auth.recovery')}</p>
      </Card>
    </div>
  );
}
