import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Config, ProviderMode } from '../config.js';
import type { Constraints } from '../domain/types.js';
import type { ParseResult } from '../domain/nlp.js';

/* ─────────── Event bus (in-process; single instance. Multi-instance: swap for Postgres LISTEN/NOTIFY or Redis) ─────────── */
type Listener = (e: { type: string; data: unknown }) => void;
export class EventBus {
  private subs = new Map<string, Set<Listener>>();
  subscribe(userId: string, fn: Listener) {
    if (!this.subs.has(userId)) this.subs.set(userId, new Set());
    this.subs.get(userId)!.add(fn);
    return () => this.subs.get(userId)?.delete(fn);
  }
  publish(userId: string, type: string, data: unknown) { this.subs.get(userId)?.forEach((fn) => fn({ type, data })); }
}

/* ─────────── OTP / phone verification ─────────── */
export interface OtpProvider {
  readonly mode: ProviderMode;
  generateCode(): string;
  send(phone: string, code: string): Promise<void>;
}
/** Test mode: fixed code, nothing is sent. Refused in production by config validation. */
export class MockOtpProvider implements OtpProvider {
  readonly mode = 'mock' as const;
  generateCode() { return '123456'; }
  async send() { /* no SMS in test mode */ }
}

/* ─────────── Payments ─────────── */
export interface ChargeResult { status: 'succeeded' | 'failed' | 'pending'; ref: string; failureReason?: string }
export interface PaymentProvider {
  readonly mode: ProviderMode;
  readonly name: string;
  charge(i: { amountMinor: number; currency: string; token: string; idempotencyKey: string }): Promise<ChargeResult>;
  refund(i: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<{ ref: string }>;
}
/**
 * Sandbox card adapter. NO raw card data ever reaches the server: clients send a provider token.
 *   tok_success  -> succeeds           tok_decline  -> declined
 *   tok_pending  -> pending; settles via signed webhook     tok_network -> simulated provider outage (throws)
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly mode = 'sandbox' as const;
  readonly name = 'sandbox-card';
  private seen = new Map<string, ChargeResult>();
  async charge(i: { amountMinor: number; currency: string; token: string; idempotencyKey: string }): Promise<ChargeResult> {
    const prior = this.seen.get(i.idempotencyKey);
    if (prior) return prior;
    if (i.token === 'tok_network') throw new Error('sandbox payment provider unreachable');
    const ref = `sbx_${crypto.createHash('sha256').update(i.idempotencyKey).digest('hex').slice(0, 16)}`;
    const res: ChargeResult =
      i.token === 'tok_success' ? { status: 'succeeded', ref }
      : i.token === 'tok_pending' ? { status: 'pending', ref }
      : { status: 'failed', ref, failureReason: i.token === 'tok_decline' ? 'card_declined' : 'invalid_token' };
    this.seen.set(i.idempotencyKey, res);
    return res;
  }
  async refund(i: { ref: string }) { return { ref: `${i.ref}_refund` }; }
}
export const signWebhook = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');
export function verifyWebhook(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const a = Buffer.from(signWebhook(secret, body)); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ─────────── AI (assistive only: parsing help; never the source of truth) ─────────── */
export interface AiProvider {
  readonly name: 'rules' | 'anthropic' | 'test-failing';
  /** Returns constraint overrides for a free-text request, or null. Output is validated; throws on provider failure. */
  enhanceParse(text: string, base: ParseResult): Promise<Partial<Constraints> | null>;
}
export class RulesOnlyAi implements AiProvider {
  readonly name = 'rules' as const;
  async enhanceParse() { return null; }
}
export class FailingAi implements AiProvider {   // used by tests to prove the deterministic fallback
  readonly name = 'test-failing' as const;
  async enhanceParse(): Promise<never> { throw new Error('AI provider unavailable'); }
}
const AiOut = z.object({
  household: z.number().int().min(1).max(12).optional(), days: z.number().int().min(1).max(62).optional(),
  budgetAed: z.number().min(0).max(100000).optional(),
  diet: z.array(z.enum(['halal', 'vegetarian', 'gluten_free', 'organic', 'high_protein', 'low_sugar'])).optional(),
  allergens: z.array(z.enum(['nuts', 'dairy', 'gluten', 'eggs', 'soy', 'fish'])).optional(),
  exclude: z.array(z.string().max(40)).max(10).optional(),
});
/** Optional live adapter (needs ANTHROPIC_API_KEY). It can only fill constraint fields; prices/products always come from the DB. */
export class AnthropicAi implements AiProvider {
  readonly name = 'anthropic' as const;
  constructor(private key: string, private model: string) {}
  async enhanceParse(text: string): Promise<Partial<Constraints> | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model, max_tokens: 400,
        system: 'Extract grocery-basket constraints from the customer message (English/Arabic/mixed). Reply with ONLY a JSON object with optional keys: household (int), days (int), budgetAed (number), diet (array of halal|vegetarian|gluten_free|organic|high_protein|low_sugar), allergens (array of nuts|dairy|gluten|eggs|soy|fish), exclude (array of short words). Omit anything not stated. Never invent values.',
        messages: [{ role: 'user', content: text.slice(0, 1500) }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
    const body: any = await res.json();
    const raw = String(body?.content?.[0]?.text ?? '');
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = AiOut.parse(JSON.parse(json));          // schema validation: anything else throws -> rules fallback
    const out: Partial<Constraints> = {};
    if (parsed.household) out.household = parsed.household;
    if (parsed.days) out.days = parsed.days;
    if (parsed.budgetAed != null) out.budgetMinor = Math.round(parsed.budgetAed * 100);
    if (parsed.diet) out.diet = parsed.diet;
    if (parsed.allergens) out.allergens = parsed.allergens;
    if (parsed.exclude) out.exclude = parsed.exclude;
    return out;
  }
}

/* ─────────── Transcription ─────────── */
export interface TranscriptionResult { text: string; readable: string; detectedLanguage: 'ar' | 'en'; uncertain: { word: string }[] }
export interface TranscriptionProvider {
  readonly mode: ProviderMode;
  transcribe(i: { audio: Buffer; mime: string; language: 'ar' | 'en' | 'auto'; mockTranscript?: string }): Promise<TranscriptionResult>;
}
/**
 * Test-mode adapter: it cannot actually understand audio. It returns the text the tester supplies (or a clearly labelled
 * sample). Words wrapped as [?word?] are returned as uncertain instead of being silently "corrected".
 */
export class MockTranscription implements TranscriptionProvider {
  readonly mode = 'mock' as const;
  async transcribe(i: { language: 'ar' | 'en' | 'auto'; mockTranscript?: string }): Promise<TranscriptionResult> {
    const raw = i.mockTranscript?.trim() || 'family of 4 for one week budget 400 dirhams including delivery halal no [?sugar?]';
    const uncertain = [...raw.matchAll(/\[\?([^\]?]+)\?\]/g)].map((m) => ({ word: m[1] }));
    const text = raw.replace(/\[\?([^\]?]+)\?\]/g, '$1');
    const readable = text.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const arabic = /[؀-ۿ]/.test(text);
    return { text, readable, detectedLanguage: i.language === 'auto' ? (arabic ? 'ar' : 'en') : i.language, uncertain };
  }
}

/* ─────────── Storage ─────────── */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export class LocalStorage implements StorageProvider {
  constructor(private dir: string) {}
  private file(key: string) {
    const f = path.resolve(this.dir, key);
    if (!f.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('invalid storage key');
    return f;
  }
  async put(key: string, data: Buffer) { const f = this.file(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, data); }
  async get(key: string) { return fs.readFile(this.file(key)); }
  async delete(key: string) { await fs.rm(this.file(key), { force: true }); }
}

/* ─────────── Geo ─────────── */
export interface GeoProvider {
  readonly mode: ProviderMode;
  nearest(lat: number, lng: number, areas: { id: string; lat: number | null; lng: number | null }[]): { id: string; km: number } | null;
}
/** Offline adapter: nearest known area centre (haversine). Replace with a live geocoder if address search is needed. */
export class OfflineGeo implements GeoProvider {
  readonly mode = 'mock' as const;
  nearest(lat: number, lng: number, areas: { id: string; lat: number | null; lng: number | null }[]) {
    const rad = (d: number) => (d * Math.PI) / 180;
    let best: { id: string; km: number } | null = null;
    for (const a of areas) {
      if (a.lat == null || a.lng == null) continue;
      const dLat = rad(Number(a.lat) - lat), dLng = rad(Number(a.lng) - lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(Number(a.lat))) * Math.sin(dLng / 2) ** 2;
      const km = 6371 * 2 * Math.asin(Math.sqrt(h));
      if (!best || km < best.km) best = { id: a.id, km };
    }
    return best;
  }
}

export interface Providers {
  otp: OtpProvider; payments: PaymentProvider; ai: AiProvider; transcription: TranscriptionProvider;
  storage: StorageProvider; geo: GeoProvider; bus: EventBus;
}
export function buildProviders(cfg: Config): Providers {
  return {
    otp: new MockOtpProvider(),
    payments: new SandboxPaymentProvider(),
    ai: cfg.aiProvider === 'anthropic' && cfg.anthropicKey ? new AnthropicAi(cfg.anthropicKey, cfg.anthropicModel) : new RulesOnlyAi(),
    transcription: new MockTranscription(),
    storage: new LocalStorage(cfg.storageDir),
    geo: new OfflineGeo(),
    bus: new EventBus(),
  };
}
