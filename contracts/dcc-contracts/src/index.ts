// ============================================================================
// @dcc/contracts — On-Chain Contract Interface Blueprints
// ============================================================================
//
// These are TypeScript interface definitions that mirror the DCC on-chain
// contract surface. They serve as:
//   1. Specification for contract developers
//   2. Type-safe client wrappers for off-chain services
//   3. Test fixture contracts for integration tests
//
// NOTE: Actual on-chain contracts will be written in whatever language DCC
// supports (e.g., Rust/WASM, custom VM). These interfaces are the canonical
// reference.
// ============================================================================

export * from './pair-registry.js';
export * from './risk-config.js';
export * from './execution-escrow.js';
export * from './synthetic-asset-factory.js';
export * from './synthetic-vault.js';
export * from './synthetic-amm.js';
export * from './redemption-router.js';
