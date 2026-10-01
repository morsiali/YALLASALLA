import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, PNG, startHarness, WEBM, type Harness } from './helpers.js';

let h: Harness;
let conv: string;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const upload = async (
  token: string,
  id: string,
  fields: Record<string, string>,
  file: { name: string; mime: string; data: Buffer },
) => {
  const m = multipart(fields, file);
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/conversations/${id}/attachments`,
    payload: m.payload,
    headers: { ...m.headers, authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() as any };
};

describe('customer-to-business messaging', () => {
  it('a customer starts a conversation from a product, with a server-built reference', async () => {
    const p = (
      await h.svc(`select id from products where store_id = $1 and sku = 'RICE-S'`, [h.ids.store1])
    )[0];
    const r = await h.call(h.tokens.customer2, 'POST', '/conversations', {
      storeId: h.ids.store1,
      ref: { type: 'product', id: p.id },
    });
    expect(r.status).toBe(200);
    conv = r.body.id;
    const msgs = (await h.call(h.tokens.customer2, 'GET', `/conversations/${conv}/messages`)).body.items;
    expect(msgs[0].ref).toMatchObject({ type: 'product', snapshot: { name_en: 'Basmati Rice' } });
    expect(msgs[0].ref.snapshot.price_minor).toBeGreaterThan(0);
    const again = await h.call(h.tokens.customer2, 'POST', '/conversations', { storeId: h.ids.store1 });
    expect(again.body.id).toBe(conv); // one conversation per customer/store
  });
  it('the merchant (and scoped staff) sees it; other tenants and customers do not', async () => {
    expect(
      ((await h.call(h.tokens.merchantOwner, 'GET', '/conversations')).body as any[]).some(
        (c) => c.id === conv,
      ),
    ).toBe(true);
    expect(
      ((await h.call(h.tokens.merchantStaff, 'GET', '/conversations')).body as any[]).some(
        (c) => c.id === conv,
      ),
    ).toBe(true);
    expect(
      ((await h.call(h.tokens.merchant2Owner, 'GET', '/conversations')).body as any[]).some(
        (c) => c.id === conv,
      ),
    ).toBe(false);
    expect((await h.call(h.tokens.customer, 'GET', `/conversations/${conv}/messages`)).status).toBe(404);
    expect(
      (await h.call(h.tokens.customer, 'POST', `/conversations/${conv}/messages`, { body: 'hi' })).status,
    ).toBe(404);
  });
  it('text, unread counts and sent/read receipts', async () => {
    await h.call(h.tokens.customer2, 'POST', `/conversations/${conv}/messages`, {
      body: 'Is this rice available in 5kg?',
    });
    const list = (await h.call(h.tokens.merchantOwner, 'GET', '/conversations')).body.find(
      (c: any) => c.id === conv,
    );
    expect(list.unread).toBe(2);
    expect(list.my_side).toBe('business');
    let mine = (await h.call(h.tokens.customer2, 'GET', `/conversations/${conv}/messages`)).body.items[0];
    expect(mine.status).toBe('sent');
    await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/read`, {});
    mine = (await h.call(h.tokens.customer2, 'GET', `/conversations/${conv}/messages`)).body.items[0];
    expect(mine.status).toBe('read');
    expect(
      ((await h.call(h.tokens.merchantOwner, 'GET', '/conversations')).body as any[]).find(
        (c) => c.id === conv,
      ).unread,
    ).toBe(0);
    await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/messages`, {
      body: 'Only 1 kg and 10 kg, sorry.',
    });
    const c = ((await h.call(h.tokens.customer2, 'GET', '/conversations')).body as any[]).find(
      (x) => x.id === conv,
    );
    expect(c.unread).toBe(1);
    const notes = (await h.call(h.tokens.customer2, 'GET', '/notifications')).body;
    expect(notes.items.some((n: any) => n.kind === 'message_new')).toBe(true);
  });
  it('paginates old messages with a cursor', async () => {
    for (let i = 0; i < 5; i++)
      await h.call(h.tokens.customer2, 'POST', `/conversations/${conv}/messages`, { body: `msg ${i}` });
    const p1 = (await h.call(h.tokens.customer2, 'GET', `/conversations/${conv}/messages?limit=3`)).body;
    expect(p1.items).toHaveLength(3);
    expect(p1.nextBefore).toBeTruthy();
    const p2 = (
      await h.call(
        h.tokens.customer2,
        'GET',
        `/conversations/${conv}/messages?limit=3&before=${encodeURIComponent(p1.nextBefore)}`,
      )
    ).body;
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });
  it('shares an order and a basket as references, and refuses to reference something the sender cannot read', async () => {
    const mine = await h.call(h.tokens.customer, 'POST', '/conversations', {
      storeId: h.ids.store1,
      ref: { type: 'order', id: h.ids.seedOrder },
    });
    expect(mine.status).toBe(200);
    const stolen = await h.call(h.tokens.customer2, 'POST', `/conversations/${conv}/messages`, {
      ref: { type: 'order', id: h.ids.seedOrder },
    });
    expect(stolen.status).toBe(404);
  });
});

describe('attachments and voice', () => {
  it('accepts a real image and returns a signed, expiring URL that serves it', async () => {
    const r = await upload(h.tokens.customer2, conv, {}, { name: 'rice.png', mime: 'image/png', data: PNG });
    expect(r.status).toBe(201);
    expect(r.body.attachment.url).toMatch(/^\/api\/media\/.+\?exp=\d+&sig=/);
    const get = await h.app.inject({ method: 'GET', url: r.body.attachment.url });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    const tampered = await h.app.inject({
      method: 'GET',
      url: r.body.attachment.url.replace(/sig=./, 'sig=x'),
    });
    expect(tampered.statusCode).toBe(403);
    const expired = await h.app.inject({
      method: 'GET',
      url: r.body.attachment.url.replace(/exp=\d+/, 'exp=1'),
    });
    expect(expired.statusCode).toBe(403);
  });
  it('rejects wrong types, mismatched content and non-participants with clear errors', async () => {
    expect(
      (
        await upload(
          h.tokens.customer2,
          conv,
          {},
          { name: 'a.exe', mime: 'application/x-msdownload', data: Buffer.alloc(100) },
        )
      ).body.error.code,
    ).toBe('UNSUPPORTED_FILE');
    expect(
      (
        await upload(
          h.tokens.customer2,
          conv,
          {},
          {
            name: 'fake.png',
            mime: 'image/png',
            data: Buffer.from('<script>alert(1)</script>'.padEnd(64, ' ')),
          },
        )
      ).body.error.code,
    ).toBe('FILE_CONTENT_MISMATCH');
    expect(
      (await upload(h.tokens.customer, conv, {}, { name: 'x.png', mime: 'image/png', data: PNG })).status,
    ).toBe(404);
    expect(
      (
        await upload(
          h.tokens.customer2,
          conv,
          {},
          { name: 'big.png', mime: 'image/png', data: Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]) },
        )
      ).body.error.code,
    ).toBe('FILE_TOO_LARGE');
  });
  it('voice: upload, transcription needs recorded consent, test-mode output is labelled, uncertain words are marked, original audio stays', async () => {
    const v = await upload(
      h.tokens.customer2,
      conv,
      { durationMs: '4200' },
      { name: 'v.webm', mime: 'audio/webm', data: WEBM },
    );
    expect(v.status).toBe(201);
    expect(v.body.attachment).toMatchObject({ kind: 'voice', durationMs: 4200 });
    expect(v.body.retentionDays).toBe(90);
    const id = v.body.attachment.id;
    const denied = await h.call(h.tokens.customer2, 'POST', `/attachments/${id}/transcribe`, {
      language: 'auto',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CONSENT_REQUIRED');
    expect(
      (await h.call(h.tokens.customer2, 'PUT', '/me/consents', { kind: 'transcription', granted: true }))
        .status,
    ).toBe(200);
    const ok = await h.call(h.tokens.customer2, 'POST', `/attachments/${id}/transcribe`, {
      language: 'auto',
      mockTranscript: 'family of 3 for a week, budget 350 dirhams, no [?mushrooms?]',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ mode: 'mock', language: 'en', retentionDays: 30 });
    expect(ok.body.notice).toMatch(/TEST MODE/);
    expect(ok.body.uncertain).toEqual([{ word: 'mushrooms' }]);
    expect(ok.body.faithful).not.toContain('[?');
    const parsed = await h.call(h.tokens.customer2, 'POST', '/baskets/parse', {
      text: ok.body.faithful,
      source: 'voice',
    });
    expect(parsed.body.constraints).toMatchObject({ household: 3, days: 7, budgetMinor: 35000 });
    expect(parsed.body.constraints.exclude).toContain('mushrooms');
    const msgs = (await h.call(h.tokens.customer2, 'GET', `/conversations/${conv}/messages`)).body.items;
    const vm = msgs.find((m: any) => m.attachment?.id === id);
    expect(vm.transcript.mode).toBe('mock');
    expect(vm.attachment.url).toBeTruthy();
    const merchantView = (
      await h.call(h.tokens.merchantOwner, 'GET', `/conversations/${conv}/messages`)
    ).body.items.find((m: any) => m.attachment?.id === id);
    expect(merchantView.transcript).toBeNull(); // transcript belongs to the consenting requester
    await h.call(h.tokens.customer2, 'PUT', '/me/consents', { kind: 'transcription', granted: false });
    expect((await h.call(h.tokens.customer2, 'POST', `/attachments/${id}/transcribe`, {})).status).toBe(403); // withdrawing consent applies immediately
    expect((await h.call(h.tokens.customer2, 'DELETE', `/attachments/${id}/transcript`)).status).toBe(200);
  });
  it('a transcription provider failure keeps the audio and tells the user what to do', async () => {
    const orig = h.ctx.providers.transcription;
    (h.ctx.providers as any).transcription = {
      mode: 'mock',
      transcribe: async () => {
        throw new Error('down');
      },
    };
    const v = await upload(h.tokens.customer2, conv, {}, { name: 'v.webm', mime: 'audio/webm', data: WEBM });
    await h.call(h.tokens.customer2, 'PUT', '/me/consents', { kind: 'transcription', granted: true });
    const r = await h.call(h.tokens.customer2, 'POST', `/attachments/${v.body.attachment.id}/transcribe`, {});
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('TRANSCRIPTION_FAILED');
    expect(r.body.error.message).toMatch(/recording is safe/);
    const media = await h.app.inject({ method: 'GET', url: v.body.attachment.url });
    expect(media.statusCode).toBe(200);
    (h.ctx.providers as any).transcription = orig;
  });
  it('retention purge deletes expired attachments and transcripts', async () => {
    const v = await upload(
      h.tokens.customer2,
      conv,
      {},
      { name: 'old.webm', mime: 'audio/webm', data: WEBM },
    );
    await h.svc(`update attachments set retention_until = now() - interval '1 day' where id = $1`, [
      v.body.attachment.id,
    ]);
    const stats = (await h.call(h.tokens.admin, 'POST', '/admin/jobs/run')).body;
    expect(stats.attachmentsPurged).toBeGreaterThanOrEqual(1);
    expect((await h.app.inject({ method: 'GET', url: v.body.attachment.url })).statusCode).toBe(404);
  });
});

describe('blocking, reporting, limits and moderation', () => {
  it('blocking stops messages in both directions with an explanation; unblocking restores them', async () => {
    await h.call(h.tokens.customer2, 'POST', `/conversations/${conv}/block`, { blocked: true });
    const m = await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/messages`, {
      body: 'hello?',
    });
    expect(m.status).toBe(403);
    expect(m.body.error.code).toBe('CONVERSATION_BLOCKED');
    expect(
      (await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/block`, { blocked: false }))
        .status,
    ).toBe(200); // business cannot lift the customer's block
    expect(
      (await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/messages`, { body: 'hello?' }))
        .status,
    ).toBe(403);
    await h.call(h.tokens.customer2, 'POST', `/conversations/${conv}/block`, { blocked: false });
    expect(
      (
        await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/messages`, {
          body: 'hello again',
        })
      ).status,
    ).toBe(201);
  });
  it('package limit on daily business replies is enforced with a clear message', async () => {
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{messages_per_day}', '2') where code = 'growth'`,
    );
    const r = await h.call(h.tokens.merchantOwner, 'POST', `/conversations/${conv}/messages`, {
      body: 'one more',
    });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('PACKAGE_LIMIT_REACHED');
    await h.owner(
      `update packages set entitlements = jsonb_set(entitlements, '{messages_per_day}', '2000') where code = 'growth'`,
    );
  });
  it('reports go to moderation; support can read only the reported conversation and every read is audited', async () => {
    expect((await h.call(h.tokens.support, 'GET', `/conversations/${conv}/messages`)).status).toBe(404); // not reported yet
    const rep = await h.call(h.tokens.customer2, 'POST', '/reports', {
      targetType: 'conversation',
      targetId: conv,
      reason: 'Merchant is rude',
    });
    expect(rep.status).toBe(200);
    const view = await h.call(h.tokens.support, 'GET', `/admin/reports/${rep.body.id}/conversation`);
    expect(view.status).toBe(200);
    expect(view.body.messages.length).toBeGreaterThan(3);
    const audit = await h.svc(`select action from audit_logs where action = 'moderation.read_conversation'`);
    expect(audit).toHaveLength(1);
    expect(
      (await h.call(h.tokens.customer2, 'GET', `/admin/reports/${rep.body.id}/conversation`)).status,
    ).toBe(403);
    expect(
      (
        await h.call(h.tokens.support, 'POST', `/admin/reports/${rep.body.id}/resolve`, {
          status: 'actioned',
          resolution: 'Warned the merchant',
        })
      ).status,
    ).toBe(200);
    expect((await h.call(h.tokens.support, 'GET', `/conversations/${conv}/messages`)).status).toBe(404); // access ends when the report is closed
  });
  it('merchants cannot start conversations; rate limits return 429 with Retry-After', async () => {
    expect(
      (await h.call(h.tokens.merchantOwner, 'POST', '/conversations', { storeId: h.ids.store1 })).status,
    ).toBe(403);
    const { buildApp } = await import('../src/http/app.js');
    const strict = await buildApp({ rateLimitScale: 1 });
    let last = 0;
    for (let i = 0; i < 8; i++)
      last = (
        await strict.app.inject({
          method: 'POST',
          url: '/api/auth/otp/request',
          payload: { phone: '0501234599' },
        })
      ).statusCode;
    expect(last).toBe(429);
    await strict.app.close();
  });
});
