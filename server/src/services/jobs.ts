import type { Ctx } from '../http/context.js';
import { expireDue } from './loyalty.js';
import { transitionOrder } from './orders.js';

/** Scheduled maintenance: retention purge, loyalty expiry, stale unpaid orders. Safe to run repeatedly. */
export async function runMaintenance(ctx: Ctx) {
  const stats = { attachmentsPurged: 0, transcriptsPurged: 0, otpPurged: 0, exportsPurged: 0, pointsExpired: 0, staleOrdersCancelled: 0 };
  await ctx.db.asService(async (q) => {
    const old = (await q.query(`select id, storage_key from attachments where deleted_at is null and retention_until < now()`)).rows;
    for (const a of old) await ctx.providers.storage.delete(a.storage_key).catch(() => undefined);
    if (old.length) await q.query(`update attachments set deleted_at = now() where id = any($1::uuid[])`, [old.map((a) => a.id)]);
    stats.attachmentsPurged = old.length;
    stats.transcriptsPurged = (await q.query(`delete from transcriptions where retention_until < now()`)).rowCount ?? 0;
    stats.otpPurged = (await q.query(`delete from otp_codes where created_at < now() - interval '1 day'`)).rowCount ?? 0;
    stats.exportsPurged = (await q.query(`delete from data_export_jobs where expires_at < now()`)).rowCount ?? 0;
    stats.pointsExpired = await expireDue(q);
  });
  const stale = (await ctx.db.service.query(
    `select id, customer_id from orders where status = 'pending_payment' and placed_at < now() - interval '30 minutes'`)).rows;
  for (const o of stale) {
    await ctx.db.asService(async (q) => {
      await q.query(`update orders set payment_status = 'failed' where id = $1`, [o.id]);
      await q.query(`update payments set status = 'failed' where order_id = $1 and status = 'pending'`, [o.id]);
    });
    await transitionOrder(ctx, { id: o.customer_id, role: 'customer' }, o.id, 'cancelled', 'payment not confirmed in time').catch(() => undefined);
    stats.staleOrdersCancelled++;
  }
  return stats;
}
