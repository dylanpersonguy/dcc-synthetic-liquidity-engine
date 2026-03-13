import { z } from 'zod';

// ============================================================================
// @dcc/config — Centralized Configuration Schemas
// ============================================================================
//
// Every service reads its config from environment variables parsed through
// these Zod schemas. This guarantees early failure on misconfiguration.
// ============================================================================

export const DatabaseConfig = z.object({
  DATABASE_URL: z.string().url(),
  DB_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
});

export const RedisConfig = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
});

export const ServerConfig = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const DccNodeConfig = z.object({
  DCC_NODE_URL: z.string().default('http://localhost:4000'),
  DCC_CHAIN_ID: z.string().default('dcc-testnet'),
});

export const JupiterConfig = z.object({
  JUPITER_API_URL: z.string().default('https://quote-api.jup.ag/v6'),
  JUPITER_TIMEOUT_MS: z.coerce.number().int().default(5000),
  JUPITER_MAX_STALENESS_MS: z.coerce.number().int().default(10000),
});

export const RaydiumConfig = z.object({
  RAYDIUM_API_URL: z.string().default('https://api-v3.raydium.io'),
  RAYDIUM_TIMEOUT_MS: z.coerce.number().int().default(5000),
  RAYDIUM_MAX_STALENESS_MS: z.coerce.number().int().default(10000),
});

export const UniswapConfig = z.object({
  UNISWAP_API_URL: z.string().default('https://api.uniswap.org/v2'),
  UNISWAP_TIMEOUT_MS: z.coerce.number().int().default(8000),
  UNISWAP_MAX_STALENESS_MS: z.coerce.number().int().default(15000),
  UNISWAP_API_KEY: z.string().optional(),
});

export const RelayerWalletConfig = z.object({
  RELAYER_DCC_PRIVATE_KEY: z.string().optional(),
  RELAYER_SOLANA_PRIVATE_KEY: z.string().optional(),
  RELAYER_EVM_PRIVATE_KEY: z.string().optional(),
});

export const MarketDataServiceConfig = ServerConfig.merge(RedisConfig).merge(DccNodeConfig).merge(JupiterConfig).merge(RaydiumConfig).merge(UniswapConfig);
export type MarketDataServiceConfig = z.infer<typeof MarketDataServiceConfig>;

export const QuoteEngineConfig = ServerConfig.merge(RedisConfig).merge(DccNodeConfig);
export type QuoteEngineConfig = z.infer<typeof QuoteEngineConfig>;

export const RouterServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type RouterServiceConfig = z.infer<typeof RouterServiceConfig>;

export const ExecutionServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type ExecutionServiceConfig = z.infer<typeof ExecutionServiceConfig>;

export const RelayerServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig).merge(RelayerWalletConfig).merge(JupiterConfig).merge(UniswapConfig);
export type RelayerServiceConfig = z.infer<typeof RelayerServiceConfig>;

export const RedemptionServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type RedemptionServiceConfig = z.infer<typeof RedemptionServiceConfig>;

export const RiskMonitorConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type RiskMonitorConfig = z.infer<typeof RiskMonitorConfig>;

export const InventoryRebalancerConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig).merge(RelayerWalletConfig);
export type InventoryRebalancerConfig = z.infer<typeof InventoryRebalancerConfig>;

// ============================================================================
// Operator Backend Service Configs
// ============================================================================

export const OperatorApiConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type OperatorApiConfig = z.infer<typeof OperatorApiConfig>;

export const ExecutionTrackerConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type ExecutionTrackerConfig = z.infer<typeof ExecutionTrackerConfig>;

export const RelayerMonitorConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type RelayerMonitorConfig = z.infer<typeof RelayerMonitorConfig>;

export const VenueHealthMonitorConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(JupiterConfig).merge(RaydiumConfig).merge(UniswapConfig);
export type VenueHealthMonitorConfig = z.infer<typeof VenueHealthMonitorConfig>;

export const MarketHealthMonitorConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type MarketHealthMonitorConfig = z.infer<typeof MarketHealthMonitorConfig>;

export const SyntheticRiskMonitorConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type SyntheticRiskMonitorConfig = z.infer<typeof SyntheticRiskMonitorConfig>;

export const SyntheticServiceConfig = ServerConfig.merge(DatabaseConfig);
export type SyntheticServiceConfig = z.infer<typeof SyntheticServiceConfig>;

export const AlertEngineConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type AlertEngineConfig = z.infer<typeof AlertEngineConfig>;

export const ProtocolControlServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type ProtocolControlServiceConfig = z.infer<typeof ProtocolControlServiceConfig>;

// ============================================================================
// Relayer Engine Service Configs
// ============================================================================

export const ExecutionWorkerConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig)
  .merge(JupiterConfig).merge(UniswapConfig).merge(RaydiumConfig).merge(RelayerWalletConfig);
export type ExecutionWorkerConfig = z.infer<typeof ExecutionWorkerConfig>;

export const InventoryManagerConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type InventoryManagerConfig = z.infer<typeof InventoryManagerConfig>;

export const HedgingEngineConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type HedgingEngineConfig = z.infer<typeof HedgingEngineConfig>;

export const ReconciliationServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig)
  .merge(JupiterConfig).merge(UniswapConfig);
export type ReconciliationServiceConfig = z.infer<typeof ReconciliationServiceConfig>;

export const QuoteRefresherConfig = ServerConfig.merge(RedisConfig)
  .merge(JupiterConfig).merge(UniswapConfig).merge(RaydiumConfig);
export type QuoteRefresherConfig = z.infer<typeof QuoteRefresherConfig>;

export const RelayerApiConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type RelayerApiConfig = z.infer<typeof RelayerApiConfig>;

// ============================================================================
// Escrow Service Configs
// ============================================================================

export const EscrowServiceConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig).merge(DccNodeConfig);
export type EscrowServiceConfig = z.infer<typeof EscrowServiceConfig>;

export const EscrowApiConfig = ServerConfig.merge(RedisConfig).merge(DatabaseConfig);
export type EscrowApiConfig = z.infer<typeof EscrowApiConfig>;

/** Helper: parse and validate config from process.env */
export function parseConfig<T extends z.ZodTypeAny>(schema: T, env: Record<string, string | undefined> = process.env): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }
  return result.data;
}
