import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from './config.js';

/** Applies db/migrations/*.sql in order (idempotent, tracked in schema_migrations). --reset drops everything first. */
export async function migrate(
  opts: { reset?: boolean; databaseUrl?: string; appPw?: string; svcPw?: string } = {},
) {
  const cfg = loadConfig();
  const client = new pg.Client({ connectionString: opts.databaseUrl ?? cfg.databaseUrl });
  await client.connect();
  try {
    if (opts.reset) {
      await client.query('drop schema public cascade; create schema public;');
    }
    // Roles are cluster-level; passwords come from env, never from migration files.
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    for (const [role, pw, bypass] of [
      ['yalasala_app', opts.appPw ?? cfg.appDbPassword, 'nobypassrls'],
      ['yalasala_service', opts.svcPw ?? cfg.serviceDbPassword, 'bypassrls'],
    ]) {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      if (exists.rowCount) await client.query(`alter role ${role} login ${bypass} password ${q(pw)}`);
      else await client.query(`create role ${role} login ${bypass} password ${q(pw)}`);
    }
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const dir = path.join(cfg.rootDir, 'db/migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      const done = await client.query('select 1 from schema_migrations where name = $1', [f]);
      if (done.rowCount) continue;
      await client.query('begin');
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query('insert into schema_migrations(name) values ($1)', [f]);
        await client.query('commit');
        console.log(`applied ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes('--reset') }).then(
    () => console.log('migrations up to date'),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
