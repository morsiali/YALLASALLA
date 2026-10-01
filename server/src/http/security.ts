import crypto from 'node:crypto';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

export interface TokenPayload {
  sub: string;
  exp: number;
  aud?: string;
}
export function signToken(secret: string, p: Omit<TokenPayload, 'exp'>, ttlSec: number): string {
  const body = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${body}.${mac(secret, body)}`;
}
export function verifyToken(secret: string, token: string | undefined, aud?: string): TokenPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = mac(secret, body);
  const a = Buffer.from(sig),
    b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (p.exp < Date.now() / 1000) return null;
    if ((p.aud ?? undefined) !== aud) return null;
    return p;
  } catch {
    return null;
  }
}

export const hashOtp = (secret: string, phone: string, code: string) =>
  crypto.createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');

export function signMedia(secret: string, id: string, ttlSec = 900): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return { exp, sig: mac(secret, `media:${id}:${exp}`) };
}
export function verifyMedia(secret: string, id: string, exp: number, sig: string): boolean {
  if (!exp || exp < Date.now() / 1000) return false;
  const a = Buffer.from(sig),
    b = Buffer.from(mac(secret, `media:${id}:${exp}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Fixed-window in-memory limiter. Single-instance only: use Redis/edge limits when scaling out (docs/SECURITY.md). */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(public scale = 1) {}
  /** returns seconds to wait when limited, else 0 */
  check(key: string, limit: number, windowSec: number): number {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + windowSec * 1000 });
      return 0;
    }
    h.n++;
    if (h.n > limit * this.scale) return Math.ceil((h.reset - now) / 1000);
    return 0;
  }
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}

export function normalizeUaePhone(raw: string): string | null {
  const d = raw.replace(/[\s\-()]/g, '');
  let m = d.match(/^(?:\+971|00971|971)(5\d{8})$/);
  if (!m) m = d.match(/^0(5\d{8})$/);
  return m ? `+971${m[1]}` : null;
}
