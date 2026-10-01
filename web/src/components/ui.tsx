import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import type { Key } from '../i18n/en';

export function Button({
  variant = 'primary',
  size,
  block,
  busy,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small';
  block?: boolean;
  busy?: boolean;
}) {
  const cls = ['btn', variant === 'primary' ? '' : variant, size ?? '', block ? 'block' : '']
    .join(' ')
    .trim();
  return (
    <button type="button" {...p} className={cls} disabled={p.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}
export const Card = ({
  children,
  className = '',
  ...p
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={`card ${className}`}>
    {children}
  </div>
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const dId = hint || error ? `${id}-d` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': dId, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <div id={dId} className="err-text" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div id={dId} className="hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
export function TextInput({
  label,
  hint,
  error,
  value,
  onChange,
  ...p
}: {
  label: string;
  hint?: string;
  error?: string | null;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(a) => (
        <input {...a} {...p} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  multi,
  label,
}: {
  options: { value: T; label: string }[];
  value: T[] | T;
  onChange: (v: any) => void;
  multi?: boolean;
  label?: string;
}) {
  const sel = Array.isArray(value) ? value : [value];
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => {
        const on = sel.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            className="chip"
            aria-pressed={multi ? on : undefined}
            aria-checked={!multi ? on : undefined}
            role={multi ? undefined : 'radio'}
            onClick={() =>
              multi ? onChange(on ? sel.filter((x) => x !== o.value) : [...sel, o.value]) : onChange(o.value)
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  step?: number;
}) {
  const { t } = useI18n();
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={t('item.decrease')}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={t('item.increase')}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}
export function Badge({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'bad' | 'test';
  icon?: string;
  children: ReactNode;
}) {
  const ic = icon ?? { ok: '✓', warn: '!', bad: '✕', info: 'i', test: '⚑' }[tone];
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden>{ic}</span>
      {children}
    </span>
  );
}
export function Alert({
  tone = 'info',
  children,
  title,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'bad';
  children: ReactNode;
  title?: string;
}) {
  const ic = { ok: '✓', warn: '!', bad: '✕', info: 'i' }[tone];
  return (
    <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <span className="ico" aria-hidden>
        {ic}
      </span>
      <div>
        {title ? (
          <strong>
            {title}
            <br />
          </strong>
        ) : null}
        {children}
      </div>
    </div>
  );
}
export const Money = ({ minor }: { minor: number }) => {
  const { money } = useI18n();
  return <span className="money">{money(minor)}</span>;
};
export const Spinner = () => <span className="spinner" role="status" aria-label="loading" />;
export const Skeleton = ({ h = 18, w = '100%' }: { h?: number; w?: string }) => (
  <div className="skeleton" style={{ height: h, width: w }} aria-hidden />
);
export const SkeletonList = ({ n = 4 }: { n?: number }) => (
  <div className="stack" aria-busy="true" aria-label="loading">
    {Array.from({ length: n }, (_, i) => (
      <Skeleton key={i} h={64} />
    ))}
  </div>
);

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        // simple focus trap
        const f = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <Button variant="ghost" size="small" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </Button>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Human-readable, localized, actionable error. Shows server-provided details when they help. */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, tError } = useI18n();
  if (!error) return null;
  const e = error as ApiError;
  const text =
    e instanceof ApiError
      ? e.code === 'NETWORK'
        ? t('error.network')
        : tError(e.code, e.message)
      : t('error.generic');
  const fields =
    e instanceof ApiError && e.code === 'VALIDATION' && Array.isArray(e.details)
      ? (e.details as { field: string; message: string }[])
      : [];
  return (
    <Alert tone="bad">
      <div>{text}</div>
      {fields.length ? (
        <ul>
          {fields.map((f, i) => (
            <li key={i}>
              {f.field}: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <div style={{ marginTop: 8 }}>
          <Button size="small" variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

const toastListeners = new Set<(m: string) => void>();
export const toast = (m: string) => toastListeners.forEach((f) => f(m));
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const f = (m: string) => {
      setMsg(m);
      setTimeout(() => setMsg(null), 3500);
    };
    toastListeners.add(f);
    return () => {
      toastListeners.delete(f);
    };
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {msg ? <div className="toast">{msg}</div> : null}
    </div>
  );
}

export const tKey = (k: string) => k as Key;
