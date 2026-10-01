import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../state/app';
import { useI18n } from '../i18n';
import { Alert, Button, Modal } from './ui';

export function AreaPicker() {
  const { t, name } = useI18n();
  const { areas, form, setArea, areaPickerOpen, setAreaPickerOpen } = useApp();
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const [locating, setLocating] = useState(false);
  if (!areaPickerOpen) return null;
  const emirates = [...new Set(areas.map((a) => a.emirate))];
  const pick = (id: string) => {
    setArea(id);
    setAreaPickerOpen(false);
  };
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setMsg({ tone: 'warn', text: t('area.location_unsupported') });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api<{ id: string | null }>('/areas/nearest', {
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const a = areas.find((x) => x.id === r.id);
          if (a?.served) pick(a.id);
          else {
            setMsg({ tone: 'warn', text: t('area.nearest_unserved') });
            if (a) setArea(a.id);
          }
        } catch {
          setMsg({ tone: 'warn', text: t('area.location_unsupported') });
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setMsg({ tone: 'info', text: t('area.location_denied') });
      },
      { timeout: 8000 },
    );
  };
  return (
    <Modal title={t('area.title')} onClose={() => setAreaPickerOpen(false)}>
      <p className="muted">{t('area.intro')}</p>
      <div>
        <Button variant="secondary" onClick={locate} busy={locating}>
          📍 {t('area.use_location')}
        </Button>
        <div className="hint">{t('area.location_help')}</div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {emirates.map((em) => (
        <section key={em}>
          <h3>{em}</h3>
          <div className="chips" role="radiogroup" aria-label={em}>
            {areas
              .filter((a) => a.emirate === em)
              .map((a) => (
                <button
                  type="button"
                  key={a.id}
                  role="radio"
                  aria-checked={form.areaId === a.id}
                  className="chip"
                  onClick={() => pick(a.id)}
                >
                  {name(a)}{' '}
                  <span className="small" style={{ opacity: 0.85 }}>
                    · {a.served ? t('area.served') : t('area.not_served')}
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
      <Alert tone="info">{t('area.pilot')}</Alert>
    </Modal>
  );
}
