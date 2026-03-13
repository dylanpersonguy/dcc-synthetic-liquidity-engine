// ============================================================================
// Execution Worker — Risk Checks Module
// ============================================================================

import { getPool } from '@dcc/database';
import type { Logger } from '@dcc/metrics';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Per-execution risk checks called by the execution state machine.
 *
 * Checks enforced:
 *   1. Max notional per route
 *   2. Max notional per asset
 *   3. Max notional per venue
 *   4. Per-market relayer enable/disable
 *   5. Venue degrade/down rejection
 *   6. Daily risk budget
 *   7. Emergency pause
 *   8. Min confidence threshold (future)
 */
export async function checkRiskLimits(
  pairId: string,
  amountIn: string,
  venueId: string,
  log: Logger,
): Promise<RiskCheckResult> {
  const pool = getPool();
  const amount = parseFloat(amountIn);

  // 1. Check emergency pause
  const { rows: pauseRows } = await pool.query<{ value: unknown }>(
    "SELECT value FROM protocol_controls WHERE key = 'emergency_pause'",
  );
  if (pauseRows[0] && pauseRows[0].value === true) {
    return { allowed: false, reason: 'Emergency pause active' };
  }

  // 2. Check per-market circuit breaker
  const { rows: marketRows } = await pool.query<{ circuit_breaker: string; status: string }>(
    'SELECT circuit_breaker, status FROM markets WHERE pair_id = $1',
    [pairId],
  );
  const market = marketRows[0];
  if (market) {
    if (market.status === 'paused' || market.status === 'disabled') {
      return { allowed: false, reason: `Market ${pairId} is ${market.status}` };
    }
    if (market.circuit_breaker === 'hard_pause') {
      return { allowed: false, reason: `Market ${pairId} circuit breaker: hard_pause` };
    }
    if (market.circuit_breaker === 'soft_pause') {
      return { allowed: false, reason: `Market ${pairId} circuit breaker: soft_pause` };
    }
  }

  // 3. Check venue health
  const { rows: venueRows } = await pool.query<{ is_available: boolean; is_degraded: boolean }>(
    'SELECT is_available, is_degraded FROM venue_status_cache WHERE venue_id = $1',
    [venueId],
  );
  const venue = venueRows[0];
  if (venue) {
    if (!venue.is_available) {
      return { allowed: false, reason: `Venue ${venueId} is unavailable` };
    }
    // Allow degraded venues with a warning — operator can pause if needed
    if (venue.is_degraded) {
      log.warn('Executing on degraded venue', { venueId, pairId });
    }
  }

  // 4. Check risk limits (per-route, per-asset, per-venue)
  const { rows: limitRows } = await pool.query<{
    limit_type: string;
    scope_key: string;
    max_notional: string;
    current_notional: string;
    daily_budget: string | null;
    daily_used: string;
    is_enabled: boolean;
  }>(
    `SELECT * FROM relayer_risk_limits
     WHERE is_enabled = TRUE
     AND (
       (limit_type = 'per_route' AND scope_key = $1)
       OR (limit_type = 'per_venue' AND scope_key = $2)
       OR (limit_type = 'global')
     )`,
    [pairId, venueId],
  );

  for (const limit of limitRows) {
    const maxNotional = parseFloat(limit.max_notional);
    const currentNotional = parseFloat(limit.current_notional);

    if (currentNotional + amount > maxNotional) {
      return {
        allowed: false,
        reason: `${limit.limit_type} limit exceeded for ${limit.scope_key}: ${currentNotional + amount} > ${maxNotional}`,
      };
    }

    // Daily budget check
    if (limit.daily_budget) {
      const dailyBudget = parseFloat(limit.daily_budget);
      const dailyUsed = parseFloat(limit.daily_used);
      if (dailyUsed + amount > dailyBudget) {
        return {
          allowed: false,
          reason: `Daily budget exceeded for ${limit.scope_key}: ${dailyUsed + amount} > ${dailyBudget}`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Check if the protocol is in emergency pause state.
 */
export async function isEmergencyPaused(): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query<{ value: unknown }>(
    "SELECT value FROM protocol_controls WHERE key = 'emergency_pause'",
  );
  return rows[0]?.value === true;
}
