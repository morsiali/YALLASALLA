import pg from 'pg';
import { migrate } from '../../server/src/migrate.ts';
import { seed } from '../../server/src/seed/seed.ts';

/** Fresh seeded database for every e2e run. */
export default async function globalSetup() {
  const base = process.env.TEST_PG_BASE ?? 'localhost:54329';
  const admin = new pg.Client({
    connectionString: `postgres://yalasala_owner:owner_dev_pw@${base}/postgres`,
  });
  await admin.connect();
  const ex = await admin.query("select 1 from pg_database where datname = 'yalasala_e2e'");
  if (!ex.rowCount) await admin.query('create database yalasala_e2e');
  await admin.end();
  await migrate({ reset: true, databaseUrl: process.env.DATABASE_URL });
  await seed(process.env.SERVICE_DATABASE_URL);
}
