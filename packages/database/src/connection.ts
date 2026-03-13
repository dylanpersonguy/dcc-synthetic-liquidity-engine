import pg from 'pg';

// ============================================================================
// PostgreSQL Connection Pool
// ============================================================================
// Single shared pool instance per process. Services import and use this.
// Pool handles connection lifecycle, retries, keepalive automatically.
// ============================================================================

let pool: pg.Pool | null = null;

export interface DbConfig {
  connectionString: string;
  poolMin?: number;
  poolMax?: number;
}

export function createPool(config: DbConfig): pg.Pool {
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: config.connectionString,
    min: config.poolMin ?? 2,
    max: config.poolMax ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });

  pool.on('error', (err) => {
    console.error(JSON.stringify({
      service: 'database',
      event: 'pool_error',
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
  });

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type { pg as PgTypes };
export { pg };
