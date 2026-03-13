// Connection
export { createPool, getPool, closePool } from './connection.js';

// Schema
export { SCHEMA_SQL } from './schema/tables.js';

// Repositories
export { executionRepo } from './repositories/execution-repo.js';
export type { ExecutionRow, ExecutionLegRow, ExecutionFilter } from './repositories/execution-repo.js';

export { marketRepo } from './repositories/market-repo.js';
export type { MarketRow, MarketFilter } from './repositories/market-repo.js';

export { relayerRepo } from './repositories/relayer-repo.js';
export type { RelayerRow, RelayerInventoryRow } from './repositories/relayer-repo.js';

export { venueHealthRepo } from './repositories/venue-health-repo.js';
export type { VenueHealthRow, ConnectorHealthRow } from './repositories/venue-health-repo.js';

export { marketHealthRepo, syntheticExposureRepo } from './repositories/monitoring-repo.js';
export type { MarketHealthRow, SyntheticExposureRow } from './repositories/monitoring-repo.js';

export { riskAlertRepo, protocolControlRepo } from './repositories/alert-control-repo.js';
export type { RiskAlertRow, AlertFilter, ProtocolControlRow } from './repositories/alert-control-repo.js';

export { metricsRepo } from './repositories/metrics-repo.js';
export type { ExecutionMetricRow, RouteMetricRow } from './repositories/metrics-repo.js';

// Relayer Engine Repositories
export { relayerJobRepo } from './repositories/relayer-job-repo.js';
export type { RelayerJobRow, RelayerJobFilter, RelayerAttemptRow } from './repositories/relayer-job-repo.js';

export { inventoryReservationRepo } from './repositories/inventory-reservation-repo.js';
export type { InventoryReservationRow } from './repositories/inventory-reservation-repo.js';

export { externalExecutionRepo } from './repositories/external-execution-repo.js';
export type { ExternalExecutionRow } from './repositories/external-execution-repo.js';

export { hedgeRepo } from './repositories/hedge-repo.js';
export type { HedgeRecordRow } from './repositories/hedge-repo.js';

export { reconciliationRepo } from './repositories/reconciliation-repo.js';
export type { ReconciliationRecordRow } from './repositories/reconciliation-repo.js';

// Relayer Schema
export { RELAYER_SCHEMA_SQL } from './schema/relayer-tables.js';

// Escrow Repositories
export { escrowIntentRepo, escrowTransitionRepo, escrowEventRepo, relayerConfirmationRepo } from './repositories/escrow-repo.js';
export type { EscrowIntentRow, EscrowTransitionRow, EscrowEventRow, RelayerConfirmationRow, EscrowFilter } from './repositories/escrow-repo.js';

// Escrow Schema
export { ESCROW_SCHEMA_SQL } from './schema/escrow-tables.js';
