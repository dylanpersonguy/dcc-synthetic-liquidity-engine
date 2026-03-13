// ============================================================================
// inventory-manager — Inventory Tracking & Reservation Service
// ============================================================================
//
// Tracks relayer inventory balances across chains and assets. Provides
// reservation/release API for the execution pipeline.
//
// Data model:
//   relayer_inventory table stores per-asset, per-chain balances:
//     - amount: total balance (from on-chain wallet)
//     - reserved_amount: locked for pending executions
//     - available_amount: amount - reserved_amount
//     - amount_usd: estimated USD value
//
// Reservation lifecycle:
//   1. reserve(asset, chain, amount) → reservationId
//   2. On success: consume(reservationId) — deducts from total
//   3. On failure: release(reservationId) — returns to available
//   4. On timeout: expired by periodic cleanup
//
// Port: 3202
// ============================================================================

import Fastify from 'fastify';
import { z } from 'zod';
import { parseConfig, InventoryManagerConfig } from '@dcc/config';
import { createPool, closePool, getPool, relayerRepo, inventoryReservationRepo } from '@dcc/database';
import {
  createLogger,
  registry,
  inventoryAvailableBalance,
  inventoryReservedBalance,
} from '@dcc/metrics';

const log = createLogger('inventory-manager');
const RELAYER_ID = 'protocol-relayer';

async function main() {
  const config = parseConfig(InventoryManagerConfig);

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify();

  // ── GET /inventory — list all positions ─────────────────────────────
  app.get('/inventory', async () => {
    const inventory = await relayerRepo.getInventory(RELAYER_ID);
    return { positions: inventory };
  });

  // ── GET /inventory/:asset — positions for a specific asset ──────────
  app.get<{ Params: { asset: string } }>('/inventory/:asset', async (req) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM relayer_inventory
       WHERE relayer_id = $1 AND asset = $2`,
      [RELAYER_ID, req.params.asset],
    );
    return { positions: rows };
  });

  // ── GET /inventory/:chain/:asset — specific chain+asset position ────
  app.get<{ Params: { chain: string; asset: string } }>('/inventory/:chain/:asset', async (req) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM relayer_inventory
       WHERE relayer_id = $1 AND asset = $2 AND chain = $3`,
      [RELAYER_ID, req.params.asset, req.params.chain],
    );
    const position = rows[0];
    if (!position) {
      return { position: null, available: '0', reserved: '0', total: '0' };
    }
    return { position };
  });

  // ── POST /inventory/reserve — reserve inventory for an execution ────
  const ReserveSchema = z.object({
    jobId: z.string(),
    executionId: z.string(),
    asset: z.string(),
    chain: z.string(),
    amount: z.string(),
    ttlMs: z.number().int().min(10000).max(600000).default(300000),
  });

  app.post('/inventory/reserve', async (req, reply) => {
    const body = ReserveSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }
    const { jobId, executionId, asset, chain, amount, ttlMs } = body.data;

    // Check available balance
    const pool = getPool();
    const { rows } = await pool.query<{ available_amount: string }>(
      `SELECT available_amount FROM relayer_inventory
       WHERE relayer_id = $1 AND asset = $2 AND chain = $3`,
      [RELAYER_ID, asset, chain],
    );

    const available = parseFloat(rows[0]?.available_amount ?? '0');
    const requested = parseFloat(amount);

    if (available < requested) {
      void reply.status(409);
      return { error: 'Insufficient inventory', available: available.toString(), requested: amount };
    }

    // Create reservation
    const reservationId = `res_${jobId}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + ttlMs);

    await inventoryReservationRepo.create({
      reservationId,
      jobId,
      executionId,
      asset,
      chain,
      amount,
      expiresAt,
    });

    // Atomically update inventory
    await pool.query(
      `UPDATE relayer_inventory
       SET reserved_amount = reserved_amount + $4,
           available_amount = GREATEST(available_amount - $4, 0),
           last_updated = NOW()
       WHERE relayer_id = $1 AND asset = $2 AND chain = $3`,
      [RELAYER_ID, asset, chain, amount],
    );

    log.info('Inventory reserved', { reservationId, asset, chain, amount, jobId });
    return { reservationId, expiresAt: expiresAt.toISOString() };
  });

  // ── POST /inventory/release — release a reservation ─────────────────
  const ReleaseSchema = z.object({
    reservationId: z.string(),
    reason: z.string(),
  });

  app.post('/inventory/release', async (req, reply) => {
    const body = ReleaseSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }
    const { reservationId, reason } = body.data;

    const reservation = await inventoryReservationRepo.findById(reservationId);
    if (!reservation) {
      void reply.status(404);
      return { error: 'Reservation not found' };
    }
    if (reservation.status !== 'active') {
      return { message: `Reservation already ${reservation.status}` };
    }

    await inventoryReservationRepo.release(reservationId, reason);

    // Return to available
    const pool = getPool();
    await pool.query(
      `UPDATE relayer_inventory
       SET reserved_amount = GREATEST(reserved_amount - $4, 0),
           available_amount = available_amount + $4,
           last_updated = NOW()
       WHERE relayer_id = $1 AND asset = $2 AND chain = $3`,
      [RELAYER_ID, reservation.asset, reservation.chain, reservation.amount],
    );

    log.info('Inventory released', { reservationId, reason });
    return { released: true };
  });

  // ── POST /inventory/consume — consume a reservation (after fill) ────
  const ConsumeSchema = z.object({ reservationId: z.string() });

  app.post('/inventory/consume', async (req, reply) => {
    const body = ConsumeSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request' };
    }

    const reservation = await inventoryReservationRepo.findById(body.data.reservationId);
    if (!reservation || reservation.status !== 'active') {
      void reply.status(404);
      return { error: 'Active reservation not found' };
    }

    await inventoryReservationRepo.consume(body.data.reservationId);

    // Deduct from total and reserved
    const pool = getPool();
    await pool.query(
      `UPDATE relayer_inventory
       SET amount = GREATEST(amount - $4, 0),
           reserved_amount = GREATEST(reserved_amount - $4, 0),
           last_updated = NOW()
       WHERE relayer_id = $1 AND asset = $2 AND chain = $3`,
      [RELAYER_ID, reservation.asset, reservation.chain, reservation.amount],
    );

    log.info('Inventory consumed', { reservationId: body.data.reservationId });
    return { consumed: true };
  });

  // ── POST /inventory/deposit — record inbound inventory ──────────────
  const DepositSchema = z.object({
    asset: z.string(),
    chain: z.string(),
    amount: z.string(),
  });

  app.post('/inventory/deposit', async (req, reply) => {
    const body = DepositSchema.safeParse(req.body);
    if (!body.success) {
      void reply.status(400);
      return { error: 'Invalid request' };
    }

    await relayerRepo.upsertInventory({
      relayer_id: RELAYER_ID,
      asset: body.data.asset,
      chain: body.data.chain,
      balance: body.data.amount,
      reserved: '0',
      available: body.data.amount,
      last_rebalanced_at: null,
    });

    log.info('Inventory deposited', body.data);
    return { deposited: true };
  });

  // ── GET /inventory/reservations — list active reservations ──────────
  app.get<{ Querystring: { asset?: string; chain?: string } }>('/inventory/reservations', async (req) => {
    const { asset, chain } = req.query;
    if (asset && chain) {
      const reservations = await inventoryReservationRepo.getActiveReservations(asset, chain);
      return { reservations };
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM inventory_reservations WHERE status = 'active' ORDER BY reserved_at DESC LIMIT 100`,
    );
    return { reservations: rows };
  });

  // ── GET /inventory/summary — aggregate summary ──────────────────────
  app.get('/inventory/summary', async () => {
    const pool = getPool();
    const { rows } = await pool.query<{
      asset: string;
      chain: string;
      total: string;
      reserved: string;
      available: string;
    }>(
      `SELECT asset, chain,
              SUM(amount) as total,
              SUM(reserved_amount) as reserved,
              SUM(available_amount) as available
       FROM relayer_inventory
       WHERE relayer_id = $1
       GROUP BY asset, chain
       ORDER BY asset, chain`,
      [RELAYER_ID],
    );

    // Determine health for each position
    const positions = rows.map(r => {
      const available = parseFloat(r.available);
      const total = parseFloat(r.total);
      const ratio = total > 0 ? available / total : 0;
      const health = ratio > 0.3 ? 'HEALTHY' : ratio > 0.1 ? 'LOW' : 'CRITICAL';
      return { ...r, health, utilizationPct: total > 0 ? ((1 - ratio) * 100).toFixed(1) : '0' };
    });

    return { positions };
  });

  // ── Health + Metrics ────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', service: 'inventory-manager', timestamp: Date.now() }));

  app.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType);
    return metrics;
  });

  // ── Background: metrics refresh + reservation cleanup ───────────────
  const metricsInterval = setInterval(async () => {
    try {
      const inventory = await relayerRepo.getInventory(RELAYER_ID);
      for (const pos of inventory) {
        inventoryAvailableBalance.set({ asset: pos.asset, chain: pos.chain }, parseFloat(pos.available));
        inventoryReservedBalance.set({ asset: pos.asset, chain: pos.chain }, parseFloat(pos.reserved));
      }
    } catch {
      // Ignore monitoring errors
    }
  }, 15_000);

  const cleanupInterval = setInterval(async () => {
    try {
      const expired = await inventoryReservationRepo.expireStale();
      if (expired > 0) {
        log.info('Cleaned up expired reservations', { count: expired });
      }
    } catch {
      // Ignore cleanup errors
    }
  }, 60_000);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Inventory manager started', { port: config.PORT });

  const shutdown = async () => {
    log.info('Shutting down inventory manager...');
    clearInterval(metricsInterval);
    clearInterval(cleanupInterval);
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
