import { createPool, closePool, getPool } from '../connection.js';
import { SCHEMA_SQL } from '../schema/tables.js';
import { RELAYER_SCHEMA_SQL } from '../schema/relayer-tables.js';
import { ESCROW_SCHEMA_SQL } from '../schema/escrow-tables.js';

async function runMigrations() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('[migrate] Connecting to database...');
  createPool({
    connectionString: databaseUrl,
    poolMin: 1,
    poolMax: 2,
  });

  const pool = getPool();

  try {
    console.log('[migrate] Applying core schema...');
    await pool.query(SCHEMA_SQL);
    console.log('[migrate] Core schema applied.');

    console.log('[migrate] Applying relayer schema...');
    await pool.query(RELAYER_SCHEMA_SQL);
    console.log('[migrate] Relayer schema applied.');

    console.log('[migrate] Applying escrow schema...');
    await pool.query(ESCROW_SCHEMA_SQL);
    console.log('[migrate] Escrow schema applied.');

    console.log('[migrate] All schemas applied successfully.');
  } catch (err) {
    console.error('[migrate] Failed to apply schema:', err);
    process.exit(1);
  } finally {
    await closePool();
    console.log('[migrate] Connection closed.');
  }
}

runMigrations();
