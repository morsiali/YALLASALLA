import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../errors.js';
import { asReqUser, requireUser, type Ctx } from '../context.js';
import type { Q } from '../../db.js';
import { audit } from '../../services/common.js';

export async function buildUserExport(q: Q, userId: string) {
  const all = async (sql: string) => (await q.query(sql, [userId])).rows;
  return {
    exportedAt: new Date().toISOString(),
    profile: (
      await all(
        'select id, phone, email, name, role, locale, status, marketing_opt_in, preferences, created_at from users where id = $1',
      )
    )[0],
    addresses: await all('select * from addresses where user_id = $1'),
    consents: await all(
      'select kind, granted, created_at from consents where user_id = $1 order by created_at',
    ),
    orders: await all(
      `select o.*, (select json_agg(i) from order_items i where i.order_id = o.id) as items from orders o where o.customer_id = $1`,
    ),
    basketGenerations: await all(
      'select id, source, constraints, result, created_at from basket_generations where user_id = $1',
    ),
    savedItems: await all('select kind, ref_id, created_at from saved_items where user_id = $1'),
    savedBaskets: await all('select * from saved_baskets where user_id = $1'),
    conversations: await all('select * from conversations where customer_id = $1'),
    messages: await all(
      `select m.* from messages m join conversations c on c.id = m.conversation_id where c.customer_id = $1 order by m.created_at`,
    ),
    attachments: await all(
      `select a.id, a.kind, a.mime, a.bytes, a.created_at, a.retention_until from attachments a join conversations c on c.id = a.conversation_id where c.customer_id = $1`,
    ),
    transcriptions: await all(
      'select id, attachment_id, faithful_text, readable_text, uncertain_words, provider_mode, created_at, retention_until from transcriptions where requested_by = $1',
    ),
    loyaltyLedger: await all('select * from loyalty_ledger where user_id = $1 order by id'),
    notifications: await all(
      'select kind, payload, read_at, created_at from notifications where user_id = $1',
    ),
    reports: await all('select * from reports where reporter_id = $1'),
    disputes: await all('select * from disputes where opened_by = $1'),
  };
}

export function registerMeRoutes(app: FastifyInstance, ctx: Ctx) {
  app.patch('/me', async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        email: z.string().email().max(120).nullable().optional(),
        locale: z.enum(['ar', 'en']).optional(),
        preferences: z
          .object({
            diet: z.array(z.string().max(30)).max(10).optional(),
            allergens: z.array(z.string().max(30)).max(10).optional(),
            exclude: z.array(z.string().max(40)).max(20).optional(),
            brands: z.array(z.string().max(60)).max(10).optional(),
            tier: z.enum(['value', 'standard', 'premium', 'any']).optional(),
            substitutionPolicy: z.enum(['auto', 'ask', 'none']).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    return asReqUser(ctx, req, async (q, u) => {
      await q.query(
        `update users set name = coalesce($2, name), email = case when $3::boolean then $4 else email end, locale = coalesce($5, locale),
                     preferences = coalesce($6::jsonb, preferences) where id = $1`,
        [
          u.id,
          b.name ?? null,
          b.email !== undefined,
          b.email ?? null,
          b.locale ?? null,
          b.preferences ? JSON.stringify(b.preferences) : null,
        ],
      );
      return (
        await q.query('select id, phone, name, email, role, locale, preferences from users where id = $1', [
          u.id,
        ])
      ).rows[0];
    });
  });

  app.get('/me/consents', async (req) =>
    asReqUser(
      ctx,
      req,
      async (q, u) =>
        (
          await q.query(
            `select distinct on (kind) kind, granted, created_at from consents where user_id = $1 order by kind, created_at desc`,
            [u.id],
          )
        ).rows,
    ),
  );
  app.put('/me/consents', async (req) => {
    const b = z
      .object({
        kind: z.enum(['location', 'transcription', 'marketing', 'personalization']),
        granted: z.boolean(),
      })
      .parse(req.body);
    return asReqUser(ctx, req, async (q, u) => {
      await q.query('insert into consents(user_id,kind,granted) values ($1,$2,$3)', [
        u.id,
        b.kind,
        b.granted,
      ]);
      if (b.kind === 'marketing')
        await q.query('update users set marketing_opt_in = $2 where id = $1', [u.id, b.granted]);
      return { kind: b.kind, granted: b.granted };
    });
  });

  const AddressBody = z.object({
    areaId: z.string().uuid(),
    label: z.string().trim().max(40).default('Home'),
    building: z.string().trim().min(1).max(120),
    unit: z.string().max(40).nullable().optional(),
    instructions: z.string().max(300).nullable().optional(),
  });
  app.get('/me/addresses', async (req) =>
    asReqUser(
      ctx,
      req,
      async (q, u) =>
        (
          await q.query(
            `select a.*, ar.name_en as area_name_en, ar.name_ar as area_name_ar, ar.emirate from addresses a join areas ar on ar.id = a.area_id where a.user_id = $1 order by a.created_at`,
            [u.id],
          )
        ).rows,
    ),
  );
  app.post('/me/addresses', async (req, reply) => {
    const b = AddressBody.parse(req.body);
    const row = await asReqUser(
      ctx,
      req,
      async (q, u) =>
        (
          await q.query(
            'insert into addresses(user_id,area_id,label,building,unit,instructions) values ($1,$2,$3,$4,$5,$6) returning *',
            [u.id, b.areaId, b.label, b.building, b.unit ?? null, b.instructions ?? null],
          )
        ).rows[0],
    );
    return reply.status(201).send(row);
  });
  app.put('/me/addresses/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = AddressBody.parse(req.body);
    return asReqUser(ctx, req, async (q) => {
      const r = await q.query(
        'update addresses set area_id=$2,label=$3,building=$4,unit=$5,instructions=$6 where id=$1 returning *',
        [id, b.areaId, b.label, b.building, b.unit ?? null, b.instructions ?? null],
      );
      if (!r.rows[0]) throw notFound('Address');
      return r.rows[0];
    });
  });
  app.delete('/me/addresses/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      await q.query('delete from addresses where id = $1', [id]);
      return { ok: true };
    });
  });

  app.get('/saved', async (req) =>
    asReqUser(ctx, req, async (q) => ({
      stores: (
        await q.query(
          `select s.id, s.name_en, s.name_ar from saved_items si join stores s on s.id = si.ref_id where si.kind = 'store'`,
        )
      ).rows,
      products: (
        await q.query(
          `select p.id, p.name_en, p.name_ar, p.brand, p.size_label, p.price_minor, p.image_url, p.store_id, p.stock_qty from saved_items si join products p on p.id = si.ref_id where si.kind = 'product'`,
        )
      ).rows,
      readyBaskets: (
        await q.query(
          `select rb.id, rb.name_en, rb.name_ar from saved_items si join ready_baskets rb on rb.id = si.ref_id where si.kind = 'ready_basket'`,
        )
      ).rows,
      baskets: (
        await q.query(
          'select id, name, store_id, items, constraints, created_at from saved_baskets order by created_at desc',
        )
      ).rows,
    })),
  );
  app.post('/saved', async (req) => {
    const b = z
      .object({ kind: z.enum(['store', 'product', 'ready_basket']), refId: z.string().uuid() })
      .parse(req.body);
    return asReqUser(ctx, req, async (q, u) => {
      await q.query('insert into saved_items(user_id,kind,ref_id) values ($1,$2,$3) on conflict do nothing', [
        u.id,
        b.kind,
        b.refId,
      ]);
      return { ok: true };
    });
  });
  app.delete('/saved/:kind/:refId', async (req) => {
    const p = z
      .object({ kind: z.enum(['store', 'product', 'ready_basket']), refId: z.string().uuid() })
      .parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      await q.query('delete from saved_items where kind = $1 and ref_id = $2', [p.kind, p.refId]);
      return { ok: true };
    });
  });
  app.post('/saved/baskets', async (req, reply) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        storeId: z.string().uuid(),
        items: z
          .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
          .min(1)
          .max(200),
        constraints: z.record(z.any()).default({}),
      })
      .parse(req.body);
    const row = await asReqUser(
      ctx,
      req,
      async (q, u) =>
        (
          await q.query(
            'insert into saved_baskets(user_id,name,store_id,items,constraints) values ($1,$2,$3,$4,$5) returning id, name',
            [u.id, b.name, b.storeId, JSON.stringify(b.items), JSON.stringify(b.constraints)],
          )
        ).rows[0],
    );
    return reply.status(201).send(row);
  });
  app.delete('/saved/baskets/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return asReqUser(ctx, req, async (q) => {
      await q.query('delete from saved_baskets where id = $1', [id]);
      return { ok: true };
    });
  });

  app.get('/notifications', async (req) =>
    asReqUser(ctx, req, async (q) => ({
      items: (
        await q.query(
          'select id, kind, payload, read_at, created_at from notifications order by created_at desc limit 50',
        )
      ).rows,
      unread: (await q.query('select count(*)::int n from notifications where read_at is null')).rows[0].n,
    })),
  );
  app.post('/notifications/read', async (req) =>
    asReqUser(ctx, req, async (q) => {
      await q.query('update notifications set read_at = now() where read_at is null');
      return { ok: true };
    }),
  );
  app.post('/me/devices', async (req) => {
    const b = z
      .object({ platform: z.enum(['web', 'android', 'ios']), token: z.string().min(8).max(500) })
      .parse(req.body);
    return asReqUser(ctx, req, async (q, u) => {
      await q.query(
        'insert into device_tokens(user_id,platform,token) values ($1,$2,$3) on conflict do nothing',
        [u.id, b.platform, b.token],
      );
      return { ok: true };
    });
  });

  // ── data export (read through the user's own RLS scope)
  app.post('/me/export', async (req, reply) => {
    const u = requireUser(req); // data access is a right even for restricted accounts
    const payload: Record<string, unknown> = await ctx.db.asUser(u, (q) => buildUserExport(q, u.id));
    // analytics events are not readable under RLS; fetch them for this verified user only
    payload.analyticsEvents = (
      await ctx.db.service.query(
        'select name, props, created_at from analytics_events where user_id = $1 order by id',
        [u.id],
      )
    ).rows;
    const job = (
      await ctx.db.service.query(
        `insert into data_export_jobs(user_id,status,payload,expires_at) values ($1,'ready',$2, now() + interval '7 days') returning id, expires_at`,
        [u.id, JSON.stringify(payload)],
      )
    ).rows[0];
    return reply.status(201).send({ id: job.id, expiresAt: job.expires_at, data: payload });
  });
  app.get('/me/export/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await asReqUser(
      ctx,
      req,
      async (q) =>
        (
          await q.query(
            'select id, payload, expires_at from data_export_jobs where id = $1 and expires_at > now()',
            [id],
          )
        ).rows[0],
    );
    if (!r) throw notFound('Export');
    return { id: r.id, expiresAt: r.expires_at, data: r.payload };
  });

  // ── deletion: anonymise personal data; financial/loyalty records are retained without identifying details
  app.post('/me/delete', async (req) => {
    const u = requireUser(req);
    const { confirm } = z.object({ confirm: z.literal('DELETE') }).parse(req.body);
    void confirm;
    return ctx.db.asService(async (q) => {
      const open = await q.query(
        `select count(*)::int n from orders where customer_id = $1 and status not in ('delivered','cancelled','rejected')`,
        [u.id],
      );
      if (open.rows[0].n > 0) {
        await q.query(
          `insert into deletion_requests(user_id,status,note) values ($1,'blocked','open orders')`,
          [u.id],
        );
        throw new AppError(
          409,
          'OPEN_ORDERS',
          'You still have orders in progress. Account deletion can run once they are delivered or cancelled.',
          { openOrders: open.rows[0].n },
        );
      }
      const atts = (
        await q.query(
          `select a.id, a.storage_key from attachments a join conversations c on c.id = a.conversation_id where c.customer_id = $1`,
          [u.id],
        )
      ).rows;
      for (const a of atts) await ctx.providers.storage.delete(a.storage_key).catch(() => undefined);
      await q.query(`update attachments set deleted_at = now() where id = any($1::uuid[])`, [
        atts.map((a) => a.id),
      ]);
      await q.query(`delete from transcriptions where requested_by = $1`, [u.id]);
      await q.query(`update messages set body = null where sender_id = $1`, [u.id]);
      await q.query(`delete from addresses where user_id = $1`, [u.id]);
      await q.query(`delete from saved_items where user_id = $1`, [u.id]);
      await q.query(`delete from saved_baskets where user_id = $1`, [u.id]);
      await q.query(`delete from device_tokens where user_id = $1`, [u.id]);
      await q.query(`delete from notifications where user_id = $1`, [u.id]);
      await q.query(`delete from data_export_jobs where user_id = $1`, [u.id]);
      await q.query(
        `update orders set address = jsonb_build_object('building', null, 'contactName', null, 'contactPhone', null, 'areaId', address->'areaId') where customer_id = $1`,
        [u.id],
      );
      await q.query(`update conversations set customer_name = null where customer_id = $1`, [u.id]);
      const fake = `+9715${crypto.randomInt(0, 1e8).toString().padStart(8, '0')}`;
      await q.query(
        `update users set phone = $2, name = null, email = null, preferences = '{}'::jsonb, marketing_opt_in = false, status = 'deleted', deleted_at = now() where id = $1`,
        [u.id, fake],
      );
      await q.query(
        `insert into deletion_requests(user_id,status,note) values ($1,'completed','anonymised')`,
        [u.id],
      );
      await audit(q, u.id, 'account.delete', 'user', u.id, null, {});
      return { deleted: true };
    });
  });
}
