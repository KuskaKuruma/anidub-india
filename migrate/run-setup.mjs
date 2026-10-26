// Step 1: apply supabase/setup.sql to the live project.
//
// Get the connection string from Supabase Dashboard → Project Settings →
// Database → Connection string → URI (use the password you set for postgres).
//
//   DATABASE_URL='postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres' \
//     node migrate/run-setup.mjs
//
// Uses the Session pooler (port 6543) or direct (5432). Do not commit the URL.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sqlPath = join(root, 'supabase', 'setup.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to your Supabase Postgres URI (see migrate/run-setup.mjs header).');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Connected. Running supabase/setup.sql …');
  await client.query(sql);
  console.log('Done. Run: node migrate/verify-setup.mjs');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  await client.end();
}
