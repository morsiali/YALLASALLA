import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiUrl, ApiError } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useApp } from '../../state/app';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n/en';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorBox,
  Modal,
  SkeletonList,
  TextInput,
  useLoad,
} from '../../components/ui';

interface Msg {
  id: string;
  senderSide: 'customer' | 'business' | 'system';
  mine: boolean;
  kind: string;
  body: string | null;
  createdAt: string;
  status?: 'sent' | 'read';
  ref: { type: string; id: string; snapshot: any } | null;
  attachment: {
    id: string;
    kind: 'image' | 'voice';
    url?: string;
    durationMs?: number;
    deleted?: boolean;
  } | null;
  transcript: {
    id: string;
    status: string;
    faithful: string;
    readable: string;
    uncertain: { word: string }[];
    mode: string;
  } | null;
}

export function ConversationList({ base = '/messages' }: { base?: string }) {
  const { t, name, date } = useI18n();
  const { tick } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api<any[]>('/conversations'), [tick]);
  return (
    <div className="stack">
      <h1>{t('chat.title')}</h1>
      {loading && !data ? (
        <SkeletonList n={3} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Card>{t('chat.empty')}</Card>
      ) : (
        <div className="stack">
          {data.map((c) => {
            const [kind, ...rest] = String(c.last_preview ?? ':').split(':');
            const body = rest.join(':');
            return (
              <Link
                key={c.id}
                to={`${base}/${c.id}`}
                className="card row between"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div>
                  <div className="strong">
                    {c.my_side === 'business'
                      ? c.customer_name || t('auth.customer')
                      : name({ en: c.store_name_en, ar: c.store_name_ar })}
                  </div>
                  <div className="small muted">
                    {kind === 'voice'
                      ? `🎤 ${t('chat.voice')}`
                      : kind === 'image'
                        ? '🖼'
                        : kind === 'reference'
                          ? '🔗'
                          : body}
                  </div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div className="small muted">{date(c.last_message_at)}</div>
                  {c.unread > 0 && <span className="badge-count">{t('chat.unread', { n: c.unread })}</span>}
                  {(c.blocked_by_customer || c.blocked_by_business) && (
                    <Badge tone="warn" icon="⛔">
                      {t('chat.blocked')}
                    </Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RefCard({ r, ordersBase }: { r: NonNullable<Msg['ref']>; ordersBase: string }) {
  const { t, name, money } = useI18n();
  const s = r.snapshot ?? {};
  return (
    <div className="refcard">
      <div className="small muted">{t(`chat.ref.${r.type}` as Key)}</div>
      {r.type === 'product' && (
        <>
          <div className="strong">
            <Link to={`/products/${r.id}`}>{name({ en: s.name_en, ar: s.name_ar })}</Link>
          </div>
          <div className="small">
            {s.brand} · {s.size_label} · {money(s.price_minor)}
          </div>
        </>
      )}
      {r.type === 'order' && (
        <div className="strong">
          <Link to={`${ordersBase}/${r.id}`}>{t('order.title', { no: s.order_no })}</Link> ·{' '}
          {t(`status.${s.status}` as Key)} · {money(s.total_minor)}
        </div>
      )}
      {r.type === 'store' && (
        <div className="strong">
          <Link to={`/stores/${r.id}`}>{name({ en: s.name_en, ar: s.name_ar })}</Link>
        </div>
      )}
      {r.type === 'ready_basket' && (
        <div className="strong">
          <Link to={`/ready/${r.id}`}>{name({ en: s.name_en, ar: s.name_ar })}</Link>
        </div>
      )}
      {r.type === 'basket' && (
        <div className="strong">
          {t('basket.lines', { n: s.item_count })} · {money(Number(s.total_minor))}
        </div>
      )}
    </div>
  );
}

function VoiceBubble({
  m,
  canTranscribe,
  onChanged,
}: {
  m: Msg;
  canTranscribe: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { config } = useApp();
  const nav = useNavigate();
  const [consentOpen, setConsentOpen] = useState(false);
  const [mock, setMock] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'faithful' | 'readable'>('faithful');
  const a = m.attachment!;
  const transcribe = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/attachments/${a.id}/transcribe`, {
        body: { language: 'auto', mockTranscript: mock || undefined },
      });
      setConsentOpen(false);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONSENT_REQUIRED') setConsentOpen(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };
  const allow = async () => {
    await api('/me/consents', { method: 'PUT', body: { kind: 'transcription', granted: true } });
    await transcribe();
  };
  const tr = m.transcript;
  const toBasket = () => {
    try {
      sessionStorage.setItem('yalasala.nl', tr!.faithful);
    } catch {
      /* ignore */
    }
    nav('/build?mode=natural');
  };
  const mode = config?.providers.transcription.mode;
  return (
    <div className="stack">
      <div>
        🎤 {t('chat.voice')}
        {a.durationMs ? ` · ${Math.round(a.durationMs / 1000)}s` : ''}
      </div>
      {a.deleted ? (
        <span className="muted small">—</span>
      ) : (
        <audio controls src={a.url ? apiUrl(a.url) : undefined} preload="none" style={{ maxWidth: '100%' }} />
      )}
      {tr?.status === 'done' ? (
        <div className="card flat stack" aria-label={t('chat.transcript')}>
          {tr.mode === 'mock' && <Badge tone="test">{t('chat.transcript.test')}</Badge>}
          <div className="seg">
            <button aria-pressed={view === 'faithful'} onClick={() => setView('faithful')}>
              {t('chat.transcript.faithful')}
            </button>
            <button aria-pressed={view === 'readable'} onClick={() => setView('readable')}>
              {t('chat.transcript.readable')}
            </button>
          </div>
          <p dir="auto" style={{ margin: 0 }}>
            {view === 'faithful' ? tr.faithful : tr.readable}
          </p>
          {tr.uncertain.length > 0 && (
            <Alert tone="warn">
              {t('chat.transcript.uncertain', {
                words: tr.uncertain.map((u) => u.word).join(locale === 'ar' ? '، ' : ', '),
              })}
            </Alert>
          )}
          <p className="hint">{t('chat.transcript.keep')}</p>
          <div className="row">
            <Button size="small" onClick={toBasket}>
              {t('chat.to_basket')}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={async () => {
                await api(`/attachments/${a.id}/transcript`, { method: 'DELETE' });
                onChanged();
              }}
            >
              {t('chat.transcript.delete')}
            </Button>
          </div>
        </div>
      ) : (
        canTranscribe &&
        !a.deleted && (
          <div className="stack">
            {mode === 'mock' && (
              <TextInput
                label={t('chat.mock_transcript')}
                value={mock}
                onChange={setMock}
                dir="auto"
                placeholder="family of 3 for a week, budget 350 dirhams, no [?mushrooms?]"
              />
            )}
            <div>
              <Button size="small" variant="secondary" onClick={transcribe} busy={busy}>
                {t('chat.transcribe')}
              </Button>
            </div>
            <ErrorBox error={error} />
          </div>
        )
      )}
      {consentOpen && (
        <Modal title={t('chat.consent.title')} onClose={() => setConsentOpen(false)}>
          <p>{t('chat.consent.body')}</p>
          <div className="row">
            <Button onClick={allow} busy={busy}>
              {t('chat.consent.allow')}
            </Button>
            <Button variant="ghost" onClick={() => setConsentOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ConversationPage({ side = 'customer' }: { side?: 'customer' | 'business' }) {
  const { id = '' } = useParams();
  const { t, name, date } = useI18n();
  const { tick, refreshCounts } = useAuth();
  const [items, setItems] = useState<Msg[]>([]);
  const [conv, setConv] = useState<any>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadErr, setUploadErr] = useState<{ err: unknown; file: Blob; name: string; dur?: number } | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ordersBase = side === 'business' ? '/business/orders' : '/orders';

  const load = useCallback(async () => {
    try {
      const list = await api<any[]>('/conversations');
      setConv(list.find((c) => c.id === id) ?? null);
      const r = await api<{ items: Msg[]; nextBefore: string | null }>(
        `/conversations/${id}/messages?limit=40`,
      );
      setItems([...r.items].reverse());
      setNextBefore(r.nextBefore);
      setError(null);
      await api(`/conversations/${id}/read`, { method: 'POST', body: {} });
      refreshCounts();
    } catch (e) {
      setError(e);
    }
  }, [id, refreshCounts]);
  useEffect(() => {
    load();
  }, [load, tick]);
  useEffect(() => {
    const i = setInterval(load, 20000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length]);
  useEffect(
    () => () => {
      recRef.current?.stream.getTracks().forEach((tk) => tk.stop());
    },
    [],
  );

  const older = async () => {
    if (!nextBefore) return;
    const r = await api<{ items: Msg[]; nextBefore: string | null }>(
      `/conversations/${id}/messages?limit=40&before=${encodeURIComponent(nextBefore)}`,
    );
    setItems((cur) => [...[...r.items].reverse(), ...cur]);
    setNextBefore(r.nextBefore);
  };
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await api(`/conversations/${id}/messages`, { body: { body } });
      setText('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };
  const upload = async (file: Blob, nm: string, dur?: number) => {
    setUploadErr(null);
    const fd = new FormData();
    if (dur) fd.append('durationMs', String(dur));
    fd.append('file', file, nm);
    try {
      await api(`/conversations/${id}/attachments`, { form: fd });
      await load();
    } catch (e) {
      setUploadErr({ err: e, file, name: nm, dur });
    }
  };
  const startRec = async () => {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setError(new ApiError(0, 'UNSUPPORTED_FILE', 'unsupported'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      const t0 = Date.now();
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tk) => tk.stop());
        const mime = (rec.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks.current, { type: mime });
        upload(
          blob,
          `voice.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`,
          Date.now() - t0,
        );
        setRecording(false);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setSecs(0);
      const iv = setInterval(() => {
        setSecs((s) => {
          if (s >= 179) {
            rec.stop();
            clearInterval(iv);
          }
          return s + 1;
        });
      }, 1000);
      rec.addEventListener('stop', () => clearInterval(iv));
    } catch {
      setError(new ApiError(0, 'CONSENT_REQUIRED', 'mic'));
    }
  };
  const stopRec = () => recRef.current?.stop();
  const toggleBlock = async () => {
    await api(`/conversations/${id}/block`, {
      body: {
        blocked: !(conv?.my_side === 'customer' ? conv?.blocked_by_customer : conv?.blocked_by_business),
      },
    });
    load();
  };
  const blocked = conv && (conv.blocked_by_customer || conv.blocked_by_business);
  const myBlock = conv && (conv.my_side === 'customer' ? conv.blocked_by_customer : conv.blocked_by_business);
  const title = conv
    ? conv.my_side === 'business'
      ? conv.customer_name || t('auth.customer')
      : name({ en: conv.store_name_en, ar: conv.store_name_ar })
    : '';

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <Link to={side === 'business' ? '/business/messages' : '/messages'}>←</Link>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h1>
        </div>
        <div className="row">
          <Button size="small" variant="ghost" onClick={toggleBlock}>
            {myBlock ? t('chat.unblock') : t('chat.block')}
          </Button>
          <Button size="small" variant="ghost" onClick={() => setReportOpen(true)}>
            {t('chat.report')}
          </Button>
        </div>
      </div>
      <div className="chat">
        <div className="msgs" role="log" aria-live="polite" aria-label={t('chat.title')}>
          {nextBefore && (
            <Button size="small" variant="ghost" onClick={older}>
              {t('chat.load_older')}
            </Button>
          )}
          {error ? <ErrorBox error={error} onRetry={load} /> : null}
          {items.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.senderSide === 'system' ? 'system' : m.mine ? 'mine' : 'theirs'}`}
            >
              {m.kind === 'substitution' && m.ref ? (
                <div>
                  <strong>{t('chat.substitution', { no: m.ref.snapshot?.order_no ?? '' })}</strong>
                  <div>
                    <Link to={`${ordersBase}/${m.ref.id}`}>
                      {t('order.title', { no: m.ref.snapshot?.order_no ?? '' })} →
                    </Link>
                  </div>
                </div>
              ) : m.kind === 'system' ? (
                <div>
                  {m.body
                    ? t(
                        `subst.${m.body.replace('substitution_', '') === 'accept' ? 'accept' : 'reject'}` as Key,
                      )
                    : t('chat.system')}
                  {m.ref && (
                    <div>
                      <Link to={`${ordersBase}/${m.ref.id}`}>
                        {t('order.title', { no: m.ref.snapshot?.order_no ?? '' })} →
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {m.ref && <RefCard r={m.ref} ordersBase={ordersBase} />}
                  {m.kind === 'image' && m.attachment?.url && (
                    <img
                      className="att"
                      src={apiUrl(m.attachment.url)}
                      alt={t('chat.attach')}
                      loading="lazy"
                    />
                  )}
                  {m.kind === 'voice' && m.attachment && (
                    <VoiceBubble m={m} canTranscribe={m.mine && side === 'customer'} onChanged={load} />
                  )}
                  {m.body && (
                    <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                      {m.body}
                    </div>
                  )}
                </>
              )}
              <div className="meta">
                <span>{date(m.createdAt)}</span>
                {m.mine && (
                  <span aria-label={m.status}>
                    {m.status === 'read' ? `✓✓ ${t('common.read')}` : `✓ ${t('common.sent')}`}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div>
          {uploadErr && (
            <Alert tone="bad">
              {t('chat.upload_failed')}{' '}
              <Button
                size="small"
                variant="secondary"
                onClick={() => upload(uploadErr.file, uploadErr.name, uploadErr.dur)}
              >
                {t('chat.retry')}
              </Button>
              <ErrorBox error={uploadErr.err} />
            </Alert>
          )}
          {blocked ? (
            <Alert tone="warn">{t('chat.blocked')}</Alert>
          ) : (
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                className="input"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('chat.placeholder')}
                aria-label={t('chat.placeholder')}
                dir="auto"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f, f.name);
                  e.target.value = '';
                }}
              />
              <Button variant="ghost" onClick={() => fileRef.current?.click()} aria-label={t('chat.attach')}>
                🖼
              </Button>
              {recording ? (
                <Button variant="danger" onClick={stopRec}>
                  ⏹ {t('chat.recording', { s: secs })}
                </Button>
              ) : (
                <Button variant="ghost" onClick={startRec} aria-label={t('chat.record')}>
                  🎤
                </Button>
              )}
              <Button type="submit" busy={sending} disabled={!text.trim()}>
                {t('chat.send')}
              </Button>
            </form>
          )}
          <p className="hint">{t('chat.delivery_note')}</p>
        </div>
      </div>
      {reportOpen && (
        <Modal title={t('chat.report')} onClose={() => setReportOpen(false)}>
          {reported ? (
            <Alert tone="ok">{t('chat.report.sent')}</Alert>
          ) : (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                await api('/reports', { body: { targetType: 'conversation', targetId: id, reason } });
                setReported(true);
              }}
            >
              <TextInput
                label={t('chat.report.reason')}
                value={reason}
                onChange={setReason}
                minLength={3}
                required
              />
              <Button type="submit">{t('chat.report')}</Button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
