# DCC Synthetic Liquidity Engine — Security Checklist

This document tracks security requirements for the DCC protocol. Each item must be verified before production deployment.

---

## Contract Access Control

- [ ] PairRegistry: `registerPair` restricted to ADMIN_ROLE
- [ ] PairRegistry: `setPairStatus` restricted to ADMIN_ROLE or OPERATOR_ROLE
- [ ] RiskConfig: `setGlobalConfig` restricted to RISK_ADMIN_ROLE
- [ ] RiskConfig: `triggerEmergencyPause` restricted to OPERATOR_ROLE
- [ ] RiskConfig: Circuit breaker de-escalation requires RISK_ADMIN_ROLE
- [ ] ExecutionEscrow: `deposit` validates nonce == currentNonce + 1
- [ ] ExecutionEscrow: `finalize` only from SETTLEMENT_ROLE
- [ ] ExecutionEscrow: `submitFillAttestation` only from whitelisted RELAYER
- [ ] ExecutionEscrow: `forceRefund` only from OPERATOR_ROLE
- [ ] SyntheticAssetFactory: `mint`/`burn` only from MINT_ROLE modules
- [ ] SyntheticVault: reserve withdrawal restricted to VAULT_ADMIN
- [ ] RedemptionRouter: `markCompleted`/`markFailed` only from REDEMPTION_SERVICE

## Escrow Safety

- [ ] Funds exit escrow ONLY via finalize XOR refund (mutually exclusive)
- [ ] Refund requires status == EXPIRED or FAILED
- [ ] Finalize requires valid FillAttestation with matching executionId
- [ ] Nonce is strictly monotonic per user address
- [ ] ExecutionId is globally unique
- [ ] Timeout refund works without relayer cooperation
- [ ] Force refund path exists for operator emergencies
- [ ] Double-finalization is impossible (idempotent check)

## Replay Protection

- [ ] User nonce enforced on-chain: nonce == user.currentNonce + 1
- [ ] Execution ID uniqueness checked before escrow creation
- [ ] Quote ID uniqueness checked before route planning
- [ ] Quote expiration enforced (reject expired quotes)

## Synthetic Asset Safety

- [ ] Supply cap enforced on-chain in `mint()` function
- [ ] Backing ratio computed from vault reserves / mark-to-market liability
- [ ] SOFT_PAUSE triggered when backingRatio < 0.9
- [ ] HARD_PAUSE triggered when backingRatio < 0.8
- [ ] Failed redemption re-mints burned tokens to user
- [ ] Oracle staleness check before price-dependent operations
- [ ] Multiple oracle sources with weighted median

## Stale Data Protection

- [ ] VenueSnapshot includes lastUpdateMs timestamp
- [ ] Staleness threshold configurable per venue and globally
- [ ] quote-engine rejects quotes when all sources are stale
- [ ] risk-monitor-service trips circuit breaker on prolonged staleness
- [ ] Router excludes stale candidates in risk filter step

## Relayer Security

- [ ] Relayer private keys stored in HSM or secrets manager (not env vars in prod)
- [ ] Relayer max notional exposure capped in RiskConfig
- [ ] Fill attestation includes verifiable external tx hash
- [ ] Relayer heartbeat monitored; SOFT_PAUSE on timeout
- [ ] Relayer failure counter tracked; auto-pause after threshold

## Rate Limiting & DoS Protection

- [ ] GET /quote endpoint rate-limited per IP
- [ ] POST /route/execute rate-limited per user address
- [ ] Max open executions per market enforced
- [ ] Max open executions per user enforced
- [ ] Redis connection pooling with limits

## Input Validation

- [ ] All API inputs validated via Zod schemas
- [ ] PairId format validated (no arbitrary strings)
- [ ] Amount fields validated as positive decimal strings
- [ ] Address fields validated per chain format
- [ ] Enum fields validated against allowed values

## Key Management

- [ ] ADMIN keys are multisig in production
- [ ] OPERATOR keys separate from ADMIN keys
- [ ] RISK_ADMIN keys separate from ADMIN keys
- [ ] Key rotation procedure documented and tested
- [ ] Emergency key revocation procedure documented

## Monitoring & Alerting

- [ ] Failed execution counter → alert at threshold
- [ ] Escrow timeout counter → alert at threshold
- [ ] Backing ratio approaching floor → alert
- [ ] Venue adapter errors → alert
- [ ] Relayer balance low → alert
- [ ] Circuit breaker trips → immediate alert

## Pause & Recovery

- [ ] Emergency pause halts all new operations
- [ ] Pause allows in-flight executions to complete or refund
- [ ] Recovery requires RISK_ADMIN approval
- [ ] Pause/recovery procedures documented in runbook
- [ ] Pause tested in staging environment
