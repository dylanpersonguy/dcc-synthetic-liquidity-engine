import { z } from 'zod';

// ============================================================================
// Common primitives used across all domain models
// ============================================================================

/** Opaque branded string IDs for type safety */
export type PairId = string & { readonly __brand: 'PairId' };
export type AssetId = string & { readonly __brand: 'AssetId' };
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type RedemptionId = string & { readonly __brand: 'RedemptionId' };
export type RelayerId = string & { readonly __brand: 'RelayerId' };
export type QuoteId = string & { readonly __brand: 'QuoteId' };
export type RouteId = string & { readonly __brand: 'RouteId' };
export type SyntheticAssetId = string & { readonly __brand: 'SyntheticAssetId' };
export type VenueId = string & { readonly __brand: 'VenueId' };
export type PoolId = string & { readonly __brand: 'PoolId' };
export type OrderbookId = string & { readonly __brand: 'OrderbookId' };

/** Chain identifiers supported by the protocol */
export const ChainId = z.enum(['dcc', 'solana', 'ethereum', 'arbitrum', 'base']);
export type ChainId = z.infer<typeof ChainId>;

/** Decimal string for precise numeric values (avoid floating point) */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal string');
export type DecimalString = z.infer<typeof DecimalString>;

/** Unix timestamp in milliseconds */
export const TimestampMs = z.number().int().positive();
export type TimestampMs = z.infer<typeof TimestampMs>;

/** Standard pagination */
export const PaginationParams = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type PaginationParams = z.infer<typeof PaginationParams>;

export const PaginatedResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional(),
  });

/** Standard error envelope */
export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
