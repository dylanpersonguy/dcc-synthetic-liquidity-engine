import { getPool } from '../connection.js';

// ============================================================================
// Venue Health Repository
// ============================================================================

export interface VenueHealthRow {
  venue_id: string;
  venue_name: string;
  venue_type: string;
  health_status: string;
  latency_ms: number;
  error_count_1h: number;
  quote_count_1h: number;
  uptime_24h: string;
  last_successful_quote: Date | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ConnectorHealthRow {
  id: number;
  venue_id: string;
  pair_id: string;
  latency_ms: number;
  quote_count: number;
  error_count: number;
  last_quote_at: Date | null;
  last_error_at: Date | null;
  metadata: Record<string, unknown>;
  updated_at: Date;
}

export const venueHealthRepo = {
  async findAll(): Promise<VenueHealthRow[]> {
    const pool = getPool();
    const result = await pool.query<VenueHealthRow>(
      'SELECT * FROM venue_health ORDER BY venue_id',
    );
    return result.rows;
  },

  async findById(venueId: string): Promise<VenueHealthRow | null> {
    const pool = getPool();
    const result = await pool.query<VenueHealthRow>(
      'SELECT * FROM venue_health WHERE venue_id = $1',
      [venueId],
    );
    return result.rows[0] ?? null;
  },

  async upsert(venue: Omit<VenueHealthRow, 'created_at' | 'updated_at'>): Promise<VenueHealthRow> {
    const pool = getPool();
    const result = await pool.query<VenueHealthRow>(
      `INSERT INTO venue_health (
        venue_id, venue_name, venue_type, health_status,
        latency_ms, error_count_1h, quote_count_1h, uptime_24h,
        last_successful_quote, last_error, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (venue_id) DO UPDATE SET
        venue_name = EXCLUDED.venue_name,
        venue_type = EXCLUDED.venue_type,
        health_status = EXCLUDED.health_status,
        latency_ms = EXCLUDED.latency_ms,
        error_count_1h = EXCLUDED.error_count_1h,
        quote_count_1h = EXCLUDED.quote_count_1h,
        uptime_24h = EXCLUDED.uptime_24h,
        last_successful_quote = EXCLUDED.last_successful_quote,
        last_error = EXCLUDED.last_error,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *`,
      [
        venue.venue_id, venue.venue_name, venue.venue_type,
        venue.health_status, venue.latency_ms, venue.error_count_1h,
        venue.quote_count_1h, venue.uptime_24h,
        venue.last_successful_quote, venue.last_error,
        JSON.stringify(venue.metadata),
      ],
    );
    return result.rows[0]!;
  },

  async getConnectorHealth(venueId?: string): Promise<ConnectorHealthRow[]> {
    const pool = getPool();
    const where = venueId ? 'WHERE venue_id = $1' : '';
    const params = venueId ? [venueId] : [];
    const result = await pool.query<ConnectorHealthRow>(
      `SELECT * FROM connector_health ${where} ORDER BY venue_id, pair_id`,
      params,
    );
    return result.rows;
  },

  async upsertConnectorHealth(item: Omit<ConnectorHealthRow, 'id' | 'updated_at'>): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO connector_health (
        venue_id, pair_id, latency_ms, quote_count, error_count,
        last_quote_at, last_error_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (venue_id, pair_id) DO UPDATE SET
        latency_ms = EXCLUDED.latency_ms,
        quote_count = EXCLUDED.quote_count,
        error_count = EXCLUDED.error_count,
        last_quote_at = COALESCE(EXCLUDED.last_quote_at, connector_health.last_quote_at),
        last_error_at = COALESCE(EXCLUDED.last_error_at, connector_health.last_error_at),
        metadata = EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        item.venue_id, item.pair_id, item.latency_ms,
        item.quote_count, item.error_count,
        item.last_quote_at, item.last_error_at,
        JSON.stringify(item.metadata),
      ],
    );
  },
};
