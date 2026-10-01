import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp, type AppOptions } from '../src/http/app.js';
import { migrate } from '../src/migrate.js';
import { seed, SEED } from '../src/seed/seed.js';
import type { Ctx } from '../src/http/context.js';

export interface Harness {
  app: FastifyInstance; ctx: Ctx; ids: Record<string, string>;
  tokens: Record<string, string>;
  call: (token: string | null, method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; headers: any }>;
  login: (phone: string, extra?: object) => Promise<string>;
  svc: (sql: string, params?: unknown[]) => Promise<any[]>;
  owner: (sql: string, params?: unknown[]) => Promise<any[]>;
  close: () => Promise<void>;
}

export async function resetDb(): Promise<Record<string, string>> {
  await migrate({ reset: true });
  return seed();
}

export async function startHarness(opts: AppOptions = {}): Promise<Harness> {
  fs.rmSync('./storage-test', { recursive: true, force: true });
  const ids = await resetDb();
  const { app, ctx } = await buildApp({ rateLimitScale: 1000, ...opts });
  await app.ready();
  const call: Harness['call'] = async (token, method, url, body, headers = {}) => {
    const res = await app.inject({
      method: method as any, url: `/api${url}`, payload: body === undefined ? undefined : (JSON.stringify(body) as any),
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    let parsed: any = null;
    try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };
  const login = async (phone: string, extra: object = {}) => {
    await call(null, 'POST', '/auth/otp/request', { phone });
    const r = await call(null, 'POST', '/auth/otp/verify', { phone, code: SEED.otp, ...extra });
    if (r.status !== 200) throw new Error(`login failed ${JSON.stringify(r.body)}`);
    return r.body.token as string;
  };
  const tokens: Record<string, string> = {};
  for (const [k, phone] of Object.entries(SEED.phones)) tokens[k] = await login(phone);
  const pool = new pg.Pool({ connectionString: process.env.SERVICE_DATABASE_URL });
  const ownerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return {
    app, ctx, ids, tokens, call, login,
    svc: async (sql, params = []) => (await pool.query(sql, params)).rows,
    owner: async (sql, params = []) => (await ownerPool.query(sql, params)).rows,
    close: async () => { await app.close(); await pool.end(); await ownerPool.end(); },
  };
}

export const idem = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

/** Minimal multipart builder for upload tests. */
export function multipart(fields: Record<string, string>, file: { name: string; mime: string; data: Buffer }) {
  const boundary = '----yalasalatest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file.name}"\r\ncontent-type: ${file.mime}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
export const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]);
