import client from 'prom-client';

// ============================================================================
// Prometheus Metrics Registry
// ============================================================================

export const registry = new client.Registry();
registry.setDefaultLabels({ app: 'dcc-liquidity-engine' });
client.collectDefaultMetrics({ register: registry });

// --- Execution Metrics ---

export const executionTotal = new client.Counter({
  name: 'dcc_execution_total',
  help: 'Total number of executions',
  labelNames: ['pair_id', 'status', 'mode'] as const,
  registers: [registry],
});

export const executionLatency = new client.Histogram({
  name: 'dcc_execution_latency_ms',
  help: 'Execution latency in milliseconds',
  labelNames: ['pair_id', 'mode'] as const,
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [registry],
});

export const executionPending = new client.Gauge({
  name: 'dcc_execution_pending',
  help: 'Number of pending executions',
  labelNames: ['pair_id'] as const,
  registers: [registry],
});

export const executionVolume = new client.Counter({
  name: 'dcc_execution_volume_usd',
  help: 'Total execution volume in USD',
  labelNames: ['pair_id', 'mode'] as const,
  registers: [registry],
});

// --- Route Metrics ---

export const routeSuccessRate = new client.Gauge({
  name: 'dcc_route_success_rate',
  help: 'Route success rate (0-1)',
  labelNames: ['pair_id', 'settlement_mode'] as const,
  registers: [registry],
});

export const routeSlippage = new client.Histogram({
  name: 'dcc_route_slippage_bps',
  help: 'Route slippage in basis points',
  labelNames: ['pair_id', 'settlement_mode'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

// --- Venue Metrics ---

export const venueLatency = new client.Histogram({
  name: 'dcc_venue_latency_ms',
  help: 'Venue quote latency in milliseconds',
  labelNames: ['venue_id', 'venue_type'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [registry],
});

export const venueHealth = new client.Gauge({
  name: 'dcc_venue_health_status',
  help: 'Venue health (1=healthy, 0.5=degraded, 0=down)',
  labelNames: ['venue_id', 'venue_type'] as const,
  registers: [registry],
});

export const venueErrorRate = new client.Gauge({
  name: 'dcc_venue_error_rate',
  help: 'Venue error rate in the last hour',
  labelNames: ['venue_id'] as const,
  registers: [registry],
});

// --- Relayer Metrics ---

export const relayerStatus = new client.Gauge({
  name: 'dcc_relayer_status',
  help: 'Relayer status (1=active, 0.5=degraded, 0=offline)',
  labelNames: ['relayer_id'] as const,
  registers: [registry],
});

export const relayerInventory = new client.Gauge({
  name: 'dcc_relayer_inventory_usd',
  help: 'Relayer total inventory in USD',
  labelNames: ['relayer_id'] as const,
  registers: [registry],
});

export const relayerActiveJobs = new client.Gauge({
  name: 'dcc_relayer_active_jobs',
  help: 'Number of active relayer jobs',
  labelNames: ['relayer_id'] as const,
  registers: [registry],
});

export const relayerLatency = new client.Histogram({
  name: 'dcc_relayer_latency_ms',
  help: 'Relayer response latency in milliseconds',
  labelNames: ['relayer_id', 'chain'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

// --- Market Health Metrics ---

export const marketHealthScore = new client.Gauge({
  name: 'dcc_market_health_score',
  help: 'Market health score (0-100)',
  labelNames: ['pair_id'] as const,
  registers: [registry],
});

export const marketLiquidity = new client.Gauge({
  name: 'dcc_market_liquidity_usd',
  help: 'Market total available liquidity in USD',
  labelNames: ['pair_id', 'source'] as const,
  registers: [registry],
});

// --- Synthetic Metrics ---

export const syntheticExposure = new client.Gauge({
  name: 'dcc_synthetic_exposure_usd',
  help: 'Net synthetic exposure in USD',
  labelNames: ['synthetic_asset_id'] as const,
  registers: [registry],
});

export const syntheticUtilization = new client.Gauge({
  name: 'dcc_synthetic_utilization',
  help: 'Synthetic supply utilization ratio (0-1)',
  labelNames: ['synthetic_asset_id'] as const,
  registers: [registry],
});

export const syntheticBackingRatio = new client.Gauge({
  name: 'dcc_synthetic_backing_ratio',
  help: 'Synthetic backing/collateral ratio',
  labelNames: ['synthetic_asset_id'] as const,
  registers: [registry],
});

// --- Alert Metrics ---

export const activeAlerts = new client.Gauge({
  name: 'dcc_active_alerts',
  help: 'Number of active (unresolved) alerts',
  labelNames: ['severity'] as const,
  registers: [registry],
});

// --- Protocol Control ---

export const protocolPaused = new client.Gauge({
  name: 'dcc_protocol_paused',
  help: 'Whether the protocol is emergency-paused (0 or 1)',
  registers: [registry],
});

export const circuitBreakerLevel = new client.Gauge({
  name: 'dcc_circuit_breaker_level',
  help: 'Circuit breaker level (0=none, 1=soft, 2=hard)',
  registers: [registry],
});

// ============================================================================
// Relayer Engine Metrics
// ============================================================================

export const relayerJobsReceived = new client.Counter({
  name: 'dcc_relayer_jobs_received_total',
  help: 'Total relayer jobs received',
  labelNames: ['pair_id', 'risk_tier'] as const,
  registers: [registry],
});

export const relayerJobsFailed = new client.Counter({
  name: 'dcc_relayer_jobs_failed_total',
  help: 'Total relayer jobs failed',
  labelNames: ['pair_id', 'failure_reason'] as const,
  registers: [registry],
});

export const relayerJobsCompleted = new client.Counter({
  name: 'dcc_relayer_jobs_completed_total',
  help: 'Total relayer jobs completed successfully',
  labelNames: ['pair_id', 'venue_id'] as const,
  registers: [registry],
});

export const relayerExecutionLatency = new client.Histogram({
  name: 'dcc_relayer_execution_latency_ms',
  help: 'End-to-end relayer execution latency in milliseconds',
  labelNames: ['pair_id', 'venue_id'] as const,
  buckets: [500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
  registers: [registry],
});

export const venueSubmissionLatency = new client.Histogram({
  name: 'dcc_venue_submission_latency_ms',
  help: 'Venue transaction submission latency in milliseconds',
  labelNames: ['venue_id', 'chain'] as const,
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const inventoryAvailableBalance = new client.Gauge({
  name: 'dcc_inventory_available_balance',
  help: 'Available (unreserved) inventory balance',
  labelNames: ['asset', 'chain'] as const,
  registers: [registry],
});

export const inventoryReservedBalance = new client.Gauge({
  name: 'dcc_inventory_reserved_balance',
  help: 'Reserved inventory balance for active executions',
  labelNames: ['asset', 'chain'] as const,
  registers: [registry],
});

export const staleQuoteRejections = new client.Counter({
  name: 'dcc_stale_quote_rejections_total',
  help: 'Total executions rejected due to stale quotes',
  labelNames: ['venue_id'] as const,
  registers: [registry],
});

export const partialFillTotal = new client.Counter({
  name: 'dcc_partial_fill_total',
  help: 'Total partial fills received',
  labelNames: ['venue_id', 'pair_id'] as const,
  registers: [registry],
});

export const reconciliationMismatch = new client.Counter({
  name: 'dcc_reconciliation_mismatch_total',
  help: 'Total reconciliation mismatches detected',
  labelNames: ['venue_id'] as const,
  registers: [registry],
});

export const hedgeResidualExposure = new client.Gauge({
  name: 'dcc_hedge_residual_exposure',
  help: 'Unhedged residual exposure amount',
  labelNames: ['asset', 'chain'] as const,
  registers: [registry],
});

export const relayerQueueDepth = new client.Gauge({
  name: 'dcc_relayer_queue_depth',
  help: 'Number of jobs waiting in the relayer queue',
  labelNames: ['state'] as const,
  registers: [registry],
});

export const riskBudgetUsed = new client.Gauge({
  name: 'dcc_risk_budget_used',
  help: 'Daily risk budget utilization (0-1)',
  labelNames: ['scope'] as const,
  registers: [registry],
});

// ============================================================================
// Escrow Metrics
// ============================================================================

export const escrowIntentsCreated = new client.Counter({
  name: 'dcc_escrow_intents_created_total',
  help: 'Total escrow intents created',
  labelNames: ['pair_id', 'execution_mode'] as const,
  registers: [registry],
});

export const escrowIntentsCompleted = new client.Counter({
  name: 'dcc_escrow_intents_completed_total',
  help: 'Total escrow intents completed successfully',
  labelNames: ['pair_id', 'execution_mode'] as const,
  registers: [registry],
});

export const escrowIntentsFailed = new client.Counter({
  name: 'dcc_escrow_intents_failed_total',
  help: 'Total escrow intents failed',
  labelNames: ['pair_id', 'failure_reason'] as const,
  registers: [registry],
});

export const escrowIntentsRefunded = new client.Counter({
  name: 'dcc_escrow_intents_refunded_total',
  help: 'Total escrow intents refunded',
  labelNames: ['pair_id', 'refund_reason'] as const,
  registers: [registry],
});

export const escrowIntentsExpired = new client.Counter({
  name: 'dcc_escrow_intents_expired_total',
  help: 'Total escrow intents expired',
  labelNames: ['pair_id'] as const,
  registers: [registry],
});

export const escrowPartialFills = new client.Counter({
  name: 'dcc_escrow_partial_fills_total',
  help: 'Total escrow partial fills',
  labelNames: ['pair_id'] as const,
  registers: [registry],
});

export const escrowActiveIntents = new client.Gauge({
  name: 'dcc_escrow_active_intents',
  help: 'Number of active (non-terminal) escrow intents',
  registers: [registry],
});

export const escrowLockedVolume = new client.Gauge({
  name: 'dcc_escrow_locked_volume',
  help: 'Total volume currently locked in escrow',
  labelNames: ['asset'] as const,
  registers: [registry],
});

export const escrowSettlementLatency = new client.Histogram({
  name: 'dcc_escrow_settlement_latency_ms',
  help: 'Escrow settlement latency from creation to completion/refund',
  labelNames: ['pair_id', 'execution_mode'] as const,
  buckets: [500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000],
  registers: [registry],
});

export const escrowRefundVolume = new client.Counter({
  name: 'dcc_escrow_refund_volume_total',
  help: 'Total volume refunded through escrow',
  labelNames: ['asset'] as const,
  registers: [registry],
});

export const escrowTimeoutRate = new client.Gauge({
  name: 'dcc_escrow_timeout_rate',
  help: 'Rate of escrow timeouts in the last hour (0-1)',
  registers: [registry],
});

export const escrowRelayerConfirmations = new client.Counter({
  name: 'dcc_escrow_relayer_confirmations_total',
  help: 'Total relayer confirmations received',
  labelNames: ['relayer_id', 'chain'] as const,
  registers: [registry],
});
