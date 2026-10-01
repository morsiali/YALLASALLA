import pg from 'pg';

const base = process.env.TEST_PG_BASE ?? 'localhost:54329';
/** Creates an empty test database once per run. Each test file then resets + seeds it (see helpers.resetDb). */
export default async function setup() {
  const admin = new pg.Client({ connectionString: `postgres://yalasala_owner:owner_dev_pw@${base}/postgres` });
  try { await admin.connect(); } catch (e) {
    throw new Error(`Cannot reach PostgreSQL at ${base}. Start it with "npm run db:local:start" (or docker compose up -d db). ${(e as Error).message}`);
  }
  const exists = await admin.query("select 1 from pg_database where datname = 'yalasala_test'");
  if (!exists.rowCount) await admin.query('create database yalasala_test');
  await admin.end();
}
