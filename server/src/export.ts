import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from './config.js';

/**
 * Exports every application table as JSON (one file per table) into ./exports/<timestamp>/.
 * This is a portable, human-readable export for audits and migrations; use scripts/backup.sh for a restorable PostgreSQL backup.
 * Secrets are never stored in these tables (OTP codes are excluded; they are short-lived hashes).
 */
const EXCLUDE = new Set(['otp_codes', 'schema_migrations']);
const cfg = loadConfig();
const client = new pg.Client({ connectionString: cfg.serviceDatabaseUrl });
await client.connect();
const dir = path.join(cfg.rootDir, 'exports', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const tables = (
  await client.query("select tablename from pg_tables where schemaname = 'public' order by 1")
).rows.map((r) => r.tablename as string);
let total = 0;
for (const t of tables.filter((x) => !EXCLUDE.has(x))) {
  const { rows } = await client.query(`select * from ${client.escapeIdentifier(t)}`);
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
  total += rows.length;
}
await client.end();
console.log(`exported ${tables.length - EXCLUDE.size} tables (${total} rows) to ${dir}`);
