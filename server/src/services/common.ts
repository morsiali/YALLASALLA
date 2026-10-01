import type { Q } from '../db.js';
import type { Ctx } from '../http/context.js';

export async function audit(
  q: Q,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  reason: string | null,
  detail: object = {},
) {
  await q.query(
    'insert into audit_logs(actor_id,action,entity,entity_id,reason,detail) values ($1,$2,$3,$4,$5,$6)',
    [actorId, action, entity, entityId, reason, JSON.stringify(detail)],
  );
}

/** In-app notification (+ live event). Provider-hosted push (FCM/APNs) plugs in here; see docs/PROVIDERS.md. */
export async function notify(
  ctx: Ctx,
  q: Q,
  userId: string,
  kind: string,
  payload: Record<string, unknown> = {},
) {
  await q.query('insert into notifications(user_id,kind,payload) values ($1,$2,$3)', [
    userId,
    kind,
    JSON.stringify(payload),
  ]);
  ctx.providers.bus.publish(userId, 'notification', { kind, ...payload });
}
export async function notifyBusiness(
  ctx: Ctx,
  q: Q,
  businessId: string,
  perm: 'orders' | 'conversations',
  kind: string,
  payload: Record<string, unknown>,
) {
  const { rows } = await q.query(
    `select user_id from business_members where business_id = $1 and (member_role = 'owner' or $2 = any(permissions))`,
    [businessId, perm],
  );
  for (const r of rows) await notify(ctx, q, r.user_id, kind, payload);
}
export async function track(q: Q, userId: string | null, name: string, props: Record<string, unknown> = {}) {
  await q.query('insert into analytics_events(user_id,name,props) values ($1,$2,$3)', [
    userId,
    name,
    JSON.stringify(props),
  ]);
}
