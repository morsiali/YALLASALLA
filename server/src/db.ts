import pg from 'pg';
import type { Config } from './config.js';

export type Q = pg.PoolClient;
export interface SessionUser { id: string; role: 'customer' | 'merchant' | 'admin' | 'support' }

// Money columns are int, counts are bigint -> parse bigint as number (values stay far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

/**
 * Two pools:
 *  - app:     role yalasala_app. Subject to Row Level Security; identity is set per transaction.
 *  - service: role yalasala_service (BYPASSRLS). Used only by named privileged workflows that perform their own
 *             authorization (auth, order placement, loyalty posting, audit, scheduled jobs).
 */
export class Db {
  readonly app: pg.Pool;
  readonly service: pg.Pool;
  constructor(cfg: Config) {
    this.app = new pg.Pool({ connectionString: cfg.appDatabaseUrl, max: 10 });
    this.service = new pg.Pool({ connectionString: cfg.serviceDatabaseUrl, max: 10 });
  }

  /** Run fn in a transaction as the (verified) user; RLS applies. user=null => anonymous. */
  async asUser<T>(user: SessionUser | null, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.run(this.app, user?.id ?? '', fn);
  }
  /** Privileged transaction. actorId is recorded by audit triggers (order history). */
  async asService<T>(fn: (q: Q) => Promise<T>, actorId = ''): Promise<T> {
    return this.run(this.service, actorId, fn);
  }
  private async run<T>(pool: pg.Pool, uid: string, fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [uid]);
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  async close() { await Promise.all([this.app.end(), this.service.end()]); }
}
