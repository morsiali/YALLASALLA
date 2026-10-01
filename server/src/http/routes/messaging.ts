import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden, notFound, unprocessable } from '../errors.js';
import { asReqUser, limit, requireActive, requireUser, type Ctx } from '../context.js';
import { signMedia, signToken, verifyMedia, verifyToken } from '../security.js';
import type { Q } from '../../db.js';
import { notify, notifyBusiness, track } from '../../services/common.js';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];
const VOICE_RETENTION_DAYS = 90,
  IMAGE_RETENTION_DAYS = 365,
  TRANSCRIPT_RETENTION_DAYS = 30;

/** Verify the bytes really look like the declared type (declared mime alone is attacker-controlled). */
export function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'webm' | 'ogg' | 'mp4' | 'mp3' | 'wav' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE') return 'wav';
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (buf.subarray(0, 4).toString() === 'OggS') return 'ogg';
  if (buf.subarray(4, 8).toString() === 'ftyp') return 'mp4';
  if (buf.subarray(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}
const FAMILY: Record<string, string[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg'],
  'audio/mp4': ['mp4'],
  'audio/x-m4a': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
};
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const RefSchema = z.object({
  type: z.enum(['product', 'store', 'basket', 'order', 'ready_basket']),
  id: z.string().uuid(),
});

/** Build the snapshot server-side from data the sender can read (RLS), never from client input. */
async function refSnapshot(q: Q, ref: z.infer<typeof RefSchema>): Promise<Record<string, unknown>> {
  const one = async (sql: string) => (await q.query(sql, [ref.id])).rows[0];
  let r: any;
  switch (ref.type) {
    case 'product':
      r = await one(
        'select id, name_en, name_ar, brand, size_label, price_minor, image_url, store_id from products where id = $1',
      );
      break;
    case 'store':
      r = await one('select id, name_en, name_ar from stores where id = $1');
      break;
    case 'ready_basket':
      r = await one('select id, name_en, name_ar, store_id from ready_baskets where id = $1');
      break;
    case 'order':
      r = await one('select id, order_no, status, total_minor from orders where id = $1');
      break;
    case 'basket':
      r = await one(
        `select id, result->'totals'->>'totalMinor' as total_minor, jsonb_array_length(result->'lines') as item_count, store_id from basket_generations where id = $1`,
      );
      break;
  }
  if (!r) throw notFound('The item you tried to share');
  return r;
}

async function signedAttachment(
  ctx: Ctx,
  a: { id: string; kind: string; mime: string; duration_ms: number | null; deleted_at: string | null },
) {
  if (a.deleted_at) return { id: a.id, kind: a.kind, deleted: true };
  const { exp, sig } = signMedia(ctx.cfg.mediaSecret, a.id);
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    durationMs: a.duration_ms,
    url: `/api/media/${a.id}?exp=${exp}&sig=${sig}`,
  };
}

export function registerMessagingRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/conversations', async (req) =>
    asReqUser(
      ctx,
      req,
      async (q) =>
        (
          await q.query(
            `select c.id, c.store_id, c.business_id, c.customer_id, c.customer_name, c.blocked_by_customer, c.blocked_by_business, c.last_message_at,
            s.name_en as store_name_en, s.name_ar as store_name_ar,
            (case when c.customer_id = app_uid() then 'customer' else 'business' end) as my_side,
            (select m.kind || ':' || coalesce(left(m.body, 80), '') from messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) as last_preview,
            (select count(*)::int from messages m where m.conversation_id = c.id
               and m.sender_side <> (case when c.customer_id = app_uid() then 'customer' else 'business' end)
               and m.created_at > coalesce((select r.last_read_at from conversation_reads r where r.conversation_id = c.id
                    and r.side = (case when c.customer_id = app_uid() then 'customer' else 'business' end)), 'epoch')) as unread
     from conversations c join stores s on s.id = c.store_id order by c.last_message_at desc limit 100`,
          )
        ).rows,
    ),
  );

  app.post('/conversations', async (req, reply) => {
    const u = requireActive(req);
    limit(ctx, req, reply, 'conv', 20, 3600);
    if (u.role !== 'customer') throw forbidden('Only customers can start conversations with a store.');
    const b = z.object({ storeId: z.string().uuid(), ref: RefSchema.optional() }).parse(req.body);
    return ctx.db.asUser(u, async (q) => {
      const store = (await q.query('select id, business_id from stores where id = $1', [b.storeId])).rows[0];
      if (!store) throw notFound('Store');
      const name = (await q.query('select name from users where id = $1', [u.id])).rows[0]?.name ?? '';
      const conv = (
        await q.query(
          `insert into conversations(customer_id,customer_name,store_id,business_id) values ($1,$2,$3,$4)
         on conflict (customer_id, store_id) do update set customer_name = excluded.customer_name returning *`,
          [u.id, String(name).split(' ')[0], store.id, store.business_id],
        )
      ).rows[0];
      if (b.ref) {
        const snap = await refSnapshot(q, b.ref);
        await q.query(
          `insert into messages(conversation_id,sender_id,sender_side,kind,ref_type,ref_id,ref_snapshot) values ($1,$2,'customer','reference',$3,$4,$5)`,
          [conv.id, u.id, b.ref.type, b.ref.id, JSON.stringify(snap)],
        );
      }
      return conv;
    });
  });

  app.get('/conversations/:id/messages', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const f = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(40),
        before: z.string().datetime().optional(),
      })
      .parse(req.query);
    const rows = await asReqUser(ctx, req, async (q) => {
      const conv = (await q.query('select id from conversations where id = $1', [id])).rows[0];
      if (!conv) throw notFound('Conversation');
      const side = (await q.query('select conv_side($1) as s', [id])).rows[0].s as string | null;
      const other = side === 'customer' ? 'business' : 'customer';
      const otherRead =
        (
          await q.query(
            'select last_read_at from conversation_reads where conversation_id = $1 and side = $2',
            [id, other],
          )
        ).rows[0]?.last_read_at ?? null;
      const { rows } = await q.query(
        `select m.id, m.sender_id, m.sender_side, m.kind, m.body, m.ref_type, m.ref_id, m.ref_snapshot, m.created_at,
                a.id as a_id, a.kind as a_kind, a.mime as a_mime, a.duration_ms as a_dur, a.deleted_at as a_del,
                t.id as t_id, t.faithful_text, t.readable_text, t.uncertain_words, t.provider_mode, t.detected_language, t.status as t_status
         from messages m left join attachments a on a.id = m.attachment_id
         left join transcriptions t on t.attachment_id = a.id and t.requested_by = app_uid()
         where m.conversation_id = $1 and ($2::timestamptz is null or m.created_at < $2)
         order by m.created_at desc, m.id desc limit $3`,
        [id, f.before ?? null, f.limit],
      );
      return rows.map((r) => ({
        ...r,
        mine: r.sender_side === side,
        read_by_other: otherRead != null && new Date(r.created_at) <= new Date(otherRead),
      }));
    });
    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        senderSide: r.sender_side,
        mine: r.mine,
        kind: r.kind,
        body: r.body,
        createdAt: r.created_at,
        status: r.mine ? (r.read_by_other ? 'read' : 'sent') : undefined, // we track sent + read; "delivered" is not separately tracked
        ref: r.ref_type ? { type: r.ref_type, id: r.ref_id, snapshot: r.ref_snapshot } : null,
        attachment: r.a_id
          ? await signedAttachment(ctx, {
              id: r.a_id,
              kind: r.a_kind,
              mime: r.a_mime,
              duration_ms: r.a_dur,
              deleted_at: r.a_del,
            })
          : null,
        transcript: r.t_id
          ? {
              id: r.t_id,
              status: r.t_status,
              faithful: r.faithful_text,
              readable: r.readable_text,
              uncertain: r.uncertain_words,
              mode: r.provider_mode,
              language: r.detected_language,
            }
          : null,
      })),
    );
    return { items, nextBefore: rows.length === f.limit ? rows[rows.length - 1].created_at : null };
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const u = requireActive(req);
    limit(ctx, req, reply, 'msg', 40, 60);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z
      .object({ body: z.string().trim().max(4000).optional(), ref: RefSchema.optional() })
      .refine((x) => x.body || x.ref, { message: 'Write a message or share an item.' })
      .parse(req.body);
    const out = await ctx.db.asUser(u, async (q) => {
      const side = await sideOf(q, id);
      await assertCanSend(ctx, q, id, side);
      const snap = b.ref ? await refSnapshot(q, b.ref) : null;
      const m = (
        await q.query(
          `insert into messages(conversation_id,sender_id,sender_side,kind,body,ref_type,ref_id,ref_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
          [
            id,
            u.id,
            side,
            b.ref && !b.body ? 'reference' : 'text',
            b.body ?? null,
            b.ref?.type ?? null,
            b.ref?.id ?? null,
            snap ? JSON.stringify(snap) : null,
          ],
        )
      ).rows[0];
      const conv = (await q.query('select customer_id, business_id from conversations where id = $1', [id]))
        .rows[0];
      return { m, side, conv };
    });
    await afterMessage(ctx, id, out.side, out.conv);
    return reply.status(201).send({ id: out.m.id, createdAt: out.m.created_at, status: 'sent' });
  });

  app.post('/conversations/:id/attachments', async (req, reply) => {
    const u = requireActive(req);
    limit(ctx, req, reply, 'upload', 15, 60);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const file = await req.file();
    if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a photo or record a voice message first.');
    const mime = file.mimetype.split(';')[0].toLowerCase();
    const kind = IMAGE_MIMES.includes(mime) ? 'image' : AUDIO_MIMES.includes(mime) ? 'voice' : null;
    if (!kind)
      throw new AppError(
        415,
        'UNSUPPORTED_FILE',
        'This file type is not supported. Send a JPEG/PNG/WebP photo or a voice recording.',
      );
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new AppError(
        413,
        'FILE_TOO_LARGE',
        'This file is larger than the 5 MB limit. Choose a smaller one.',
      );
    }
    if (file.file.truncated)
      throw new AppError(
        413,
        'FILE_TOO_LARGE',
        'This file is larger than the 5 MB limit. Choose a smaller one.',
      );
    if (kind === 'voice' && buf.length > 3 * 1024 * 1024)
      throw new AppError(
        413,
        'FILE_TOO_LARGE',
        'Voice messages are limited to 3 MB (about 3 minutes). Record a shorter message.',
      );
    const type = sniff(buf);
    if (!type || !FAMILY[mime]?.includes(type))
      throw new AppError(
        415,
        'FILE_CONTENT_MISMATCH',
        'The file content does not match its type, so it was not uploaded.',
      );
    const durationRaw = (file.fields.durationMs as any)?.value;
    const durationMs = durationRaw
      ? Math.min(180000, Math.max(0, parseInt(String(durationRaw), 10) || 0))
      : null;
    const key = `conv/${id}/${crypto.randomUUID()}.${EXT[mime]}`;
    const out = await ctx.db.asUser(u, async (q) => {
      const side = await sideOf(q, id);
      await assertCanSend(ctx, q, id, side);
      await ctx.providers.storage.put(key, buf);
      try {
        const days = kind === 'voice' ? VOICE_RETENTION_DAYS : IMAGE_RETENTION_DAYS;
        const a = (
          await q.query(
            `insert into attachments(conversation_id,uploader_id,kind,mime,bytes,storage_key,duration_ms,retention_until) values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8)) returning *`,
            [id, u.id, kind, mime, buf.length, key, durationMs, days],
          )
        ).rows[0];
        const m = (
          await q.query(
            `insert into messages(conversation_id,sender_id,sender_side,kind,attachment_id) values ($1,$2,$3,$4,$5) returning id, created_at`,
            [id, u.id, side, kind, a.id],
          )
        ).rows[0];
        const conv = (await q.query('select customer_id, business_id from conversations where id = $1', [id]))
          .rows[0];
        return { a, m, side, conv };
      } catch (e) {
        await ctx.providers.storage.delete(key).catch(() => undefined);
        throw e;
      }
    });
    await afterMessage(ctx, id, out.side, out.conv);
    return reply.status(201).send({
      messageId: out.m.id,
      attachment: await signedAttachment(ctx, out.a),
      retentionDays: kind === 'voice' ? VOICE_RETENTION_DAYS : IMAGE_RETENTION_DAYS,
    });
  });

  app.post('/conversations/:id/read', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      const side = await sideOf(q, id);
      await q.query(
        `insert into conversation_reads(conversation_id,side,last_read_at) values ($1,$2,now())
                     on conflict (conversation_id, side) do update set last_read_at = now()`,
        [id, side],
      );
      return { ok: true };
    });
  });

  app.post('/conversations/:id/block', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const side = await sideOf(q, id);
      const col = side === 'customer' ? 'blocked_by_customer' : 'blocked_by_business';
      await q.query(`update conversations set ${col} = $2 where id = $1`, [id, blocked]);
      return { blocked };
    });
  });

  app.post('/reports', async (req, reply) => {
    const u = requireActive(req);
    limit(ctx, req, reply, 'report', 10, 3600);
    const b = z
      .object({
        targetType: z.enum(['conversation', 'message', 'store', 'product', 'order']),
        targetId: z.string().uuid(),
        reason: z.string().trim().min(3).max(1000),
      })
      .parse(req.body);
    return ctx.db.asUser(
      u,
      async (q) =>
        (
          await q.query(
            'insert into reports(reporter_id,target_type,target_id,reason) values ($1,$2,$3,$4) returning id, status',
            [u.id, b.targetType, b.targetId, b.reason],
          )
        ).rows[0],
    );
  });

  /** Signed, expiring media URL; the signature is only handed to users who can already read the message (RLS). */
  app.get('/media/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { exp, sig } = z.object({ exp: z.coerce.number(), sig: z.string().max(200) }).parse(req.query);
    if (!verifyMedia(ctx.cfg.mediaSecret, id, exp, sig))
      throw new AppError(
        403,
        'LINK_EXPIRED',
        'This media link expired. Reopen the conversation to refresh it.',
      );
    const a = (
      await ctx.db.service.query('select storage_key, mime, deleted_at from attachments where id = $1', [id])
    ).rows[0];
    if (!a || a.deleted_at) throw notFound('File');
    const data = await ctx.providers.storage.get(a.storage_key);
    return reply
      .header('content-type', a.mime)
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  });

  /** Transcription requires explicit, recorded consent. Test-mode output is labelled and the original audio stays accessible. */
  app.post('/attachments/:id/transcribe', async (req, reply) => {
    const u = requireActive(req);
    limit(ctx, req, reply, 'transcribe', 10, 60);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z
      .object({
        language: z.enum(['ar', 'en', 'auto']).default('auto'),
        mockTranscript: z.string().max(1000).optional(),
      })
      .parse(req.body ?? {});
    const att = await ctx.db.asUser(u, async (q) => {
      const a = (await q.query('select * from attachments where id = $1', [id])).rows[0];
      if (!a || a.deleted_at) throw notFound('Voice message');
      if (a.kind !== 'voice') throw unprocessable('NOT_VOICE', 'Only voice messages can be transcribed.');
      const consent = (
        await q.query(
          `select granted from consents where user_id = $1 and kind = 'transcription' order by created_at desc limit 1`,
          [u.id],
        )
      ).rows[0];
      if (!consent?.granted)
        throw new AppError(
          403,
          'CONSENT_REQUIRED',
          'Transcription needs your permission. Transcripts are kept for 30 days and you can delete them. Turn it on in Privacy settings to continue.',
        );
      return a;
    });
    const audio = await ctx.providers.storage.get(att.storage_key);
    const mode = ctx.providers.transcription.mode;
    try {
      const r = await ctx.providers.transcription.transcribe({
        audio,
        mime: att.mime,
        language: b.language,
        mockTranscript: ctx.providers.transcription.mode === 'mock' ? b.mockTranscript : undefined,
      });
      const row = await ctx.db.asService(async (q) => {
        await q.query('delete from transcriptions where attachment_id = $1 and requested_by = $2', [
          id,
          u.id,
        ]);
        return (
          await q.query(
            `insert into transcriptions(attachment_id,requested_by,language,detected_language,status,provider_mode,faithful_text,readable_text,uncertain_words,retention_until)
           values ($1,$2,$3,$4,'done',$5,$6,$7,$8, now() + make_interval(days => $9)) returning id`,
            [
              id,
              u.id,
              b.language,
              r.detectedLanguage,
              mode,
              r.text,
              r.readable,
              JSON.stringify(r.uncertain),
              TRANSCRIPT_RETENTION_DAYS,
            ],
          )
        ).rows[0];
      });
      return {
        id: row.id,
        status: 'done',
        mode,
        faithful: r.text,
        readable: r.readable,
        uncertain: r.uncertain,
        language: r.detectedLanguage,
        retentionDays: TRANSCRIPT_RETENTION_DAYS,
        notice:
          mode === 'mock'
            ? 'TEST MODE: this transcript was supplied by the tester, not produced from the audio.'
            : undefined,
      };
    } catch {
      await ctx.db.asService(async (q) => {
        await q.query(
          `insert into transcriptions(attachment_id,requested_by,language,status,provider_mode,error,retention_until) values ($1,$2,$3,'failed',$4,'provider_error', now() + interval '1 day')`,
          [id, u.id, b.language, mode],
        );
      });
      throw new AppError(
        502,
        'TRANSCRIPTION_FAILED',
        'We could not transcribe this voice message. Your recording is safe: you can listen to it, try again, or type your request instead.',
      );
    }
  });

  app.delete('/attachments/:id/transcript', async (req) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await ctx.db.asService((q) =>
      q.query('delete from transcriptions where attachment_id = $1 and requested_by = $2', [id, u.id]),
    );
    return { ok: true };
  });

  // Live updates via Server-Sent Events. The long-lived token never appears in a URL: a 60-second ticket does.
  app.post('/events/ticket', async (req) => ({
    ticket: signToken(ctx.cfg.authSecret, { sub: requireUser(req).id, aud: 'sse' }, 60),
  }));
  app.get('/events', (req, reply) => {
    const tok = verifyToken(ctx.cfg.authSecret, String((req.query as any).ticket ?? ''), 'sse');
    if (!tok) {
      reply
        .status(401)
        .send({ error: { code: 'AUTH_REQUIRED', message: 'Live updates need a fresh sign-in.' } });
      return;
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': req.headers.origin ?? '*',
    });
    res.write('retry: 4000\n\n');
    const off = ctx.providers.bus.subscribe(tok.sub, (e) =>
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`),
    );
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
  });
}

async function sideOf(q: Q, convId: string): Promise<'customer' | 'business'> {
  const s = (await q.query('select conv_side($1) as s', [convId])).rows[0].s;
  if (!s) throw notFound('Conversation');
  return s;
}
async function assertCanSend(ctx: Ctx, q: Q, convId: string, side: 'customer' | 'business') {
  const c = (
    await q.query(
      'select blocked_by_customer, blocked_by_business, business_id from conversations where id = $1',
      [convId],
    )
  ).rows[0];
  if (c.blocked_by_customer || c.blocked_by_business)
    throw new AppError(
      403,
      'CONVERSATION_BLOCKED',
      'This conversation is blocked, so new messages cannot be sent. Unblock it or contact support.',
    );
  if (side === 'business') {
    // package entitlement: replies per day
    const ent = (
      await q.query(
        `select p.entitlements from businesses b join packages p on p.id = b.package_id where b.id = $1`,
        [c.business_id],
      )
    ).rows[0]?.entitlements;
    const max = ent?.messages_per_day;
    if (max != null) {
      const n = (
        await q.query(
          `select count(*)::int n from messages m join conversations cv on cv.id = m.conversation_id where cv.business_id = $1 and m.sender_side = 'business' and m.created_at > now() - interval '1 day'`,
          [c.business_id],
        )
      ).rows[0].n;
      if (n >= max)
        throw new AppError(
          429,
          'PACKAGE_LIMIT_REACHED',
          `Your package allows ${max} replies per day and the limit was reached. Upgrade your package to keep replying today.`,
          { limit: max },
        );
    }
  }
}
async function afterMessage(
  ctx: Ctx,
  convId: string,
  side: 'customer' | 'business',
  conv: { customer_id: string; business_id: string },
) {
  await ctx.db.asService(async (q) => {
    if (side === 'customer')
      await notifyBusiness(ctx, q, conv.business_id, 'conversations', 'message_new', {
        conversationId: convId,
      });
    else await notify(ctx, q, conv.customer_id, 'message_new', { conversationId: convId });
    await track(q, null, 'message_sent', { side });
  });
}
