// ============================================================================
// Inventory Reservation Repository
// ============================================================================

import { getPool } from '../connection.js';

export interface InventoryReservationRow {
  reservation_id: string;
  job_id: string;
  execution_id: string;
  asset: string;
  chain: string;
  amount: string;
  status: string;
  reserved_at: string;
  released_at: string | null;
  consumed_at: string | null;
  expires_at: string;
  release_reason: string | null;
  metadata: unknown;
}

export const inventoryReservationRepo = {
  async create(reservation: {
    reservationId: string;
    jobId: string;
    executionId: string;
    asset: string;
    chain: string;
    amount: string;
    expiresAt: Date;
  }): Promise<InventoryReservationRow> {
    const pool = getPool();
    const { rows } = await pool.query<InventoryReservationRow>(
      `INSERT INTO inventory_reservations (reservation_id, job_id, execution_id, asset, chain, amount, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [reservation.reservationId, reservation.jobId, reservation.executionId,
       reservation.asset, reservation.chain, reservation.amount, reservation.expiresAt],
    );
    return rows[0]!;
  },

  async findById(reservationId: string): Promise<InventoryReservationRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<InventoryReservationRow>(
      'SELECT * FROM inventory_reservations WHERE reservation_id = $1',
      [reservationId],
    );
    return rows[0] ?? null;
  },

  async findByJobId(jobId: string): Promise<InventoryReservationRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<InventoryReservationRow>(
      'SELECT * FROM inventory_reservations WHERE job_id = $1 ORDER BY reserved_at ASC',
      [jobId],
    );
    return rows;
  },

  async release(reservationId: string, reason: string): Promise<boolean> {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE inventory_reservations
       SET status = 'released', released_at = NOW(), release_reason = $2
       WHERE reservation_id = $1 AND status = 'active'`,
      [reservationId, reason],
    );
    return (rowCount ?? 0) > 0;
  },

  async consume(reservationId: string): Promise<boolean> {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE inventory_reservations
       SET status = 'consumed', consumed_at = NOW()
       WHERE reservation_id = $1 AND status = 'active'`,
      [reservationId],
    );
    return (rowCount ?? 0) > 0;
  },

  async expireStale(): Promise<number> {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE inventory_reservations
       SET status = 'expired', released_at = NOW(), release_reason = 'expiry'
       WHERE status = 'active' AND expires_at < NOW()`,
    );
    return rowCount ?? 0;
  },

  async getActiveReservations(asset: string, chain: string): Promise<InventoryReservationRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<InventoryReservationRow>(
      `SELECT * FROM inventory_reservations
       WHERE asset = $1 AND chain = $2 AND status = 'active'
       ORDER BY reserved_at ASC`,
      [asset, chain],
    );
    return rows;
  },

  async getTotalReserved(asset: string, chain: string): Promise<string> {
    const pool = getPool();
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM inventory_reservations
       WHERE asset = $1 AND chain = $2 AND status = 'active'`,
      [asset, chain],
    );
    return rows[0]?.total ?? '0';
  },
};
