import { useQuery } from '@tanstack/react-query';
import * as api from '@/api/client';

export function useMarkets() {
  return useQuery({ queryKey: ['markets'], queryFn: api.getMarkets, refetchInterval: 10_000 });
}

export function useMarket(pairId: string) {
  return useQuery({ queryKey: ['market', pairId], queryFn: () => api.getMarket(pairId), refetchInterval: 10_000 });
}

export function useQuote(pairId: string, side: 'buy' | 'sell', amount: string, enabled: boolean) {
  return useQuery({
    queryKey: ['quote', pairId, side, amount],
    queryFn: () => api.getQuote({ pairId, side, amount }),
    enabled: enabled && !!amount && parseFloat(amount) > 0,
    refetchInterval: 12_000,
    staleTime: 8_000,
  });
}

export function useExecution(executionId: string) {
  return useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => api.getExecution(executionId),
    refetchInterval: 5_000,
  });
}

export function useExecutions() {
  return useQuery({ queryKey: ['executions'], queryFn: api.getExecutions, refetchInterval: 10_000 });
}

export function useOperatorSummary() {
  return useQuery({ queryKey: ['operator-summary'], queryFn: api.getOperatorSummary, refetchInterval: 15_000 });
}

export function useRelayerStatus() {
  return useQuery({ queryKey: ['relayer-status'], queryFn: api.getRelayerStatus, refetchInterval: 10_000 });
}

export function useVenueHealth() {
  return useQuery({ queryKey: ['venue-health'], queryFn: api.getVenueHealth, refetchInterval: 10_000 });
}

export function useRiskAlerts() {
  return useQuery({ queryKey: ['risk-alerts'], queryFn: api.getRiskAlerts, refetchInterval: 15_000 });
}

export function useMarketRisks() {
  return useQuery({ queryKey: ['market-risks'], queryFn: api.getMarketRisks, refetchInterval: 15_000 });
}

// ── Synthetic Queries ──────────────────────────────────────────────────

export function useSyntheticAssets() {
  return useQuery({ queryKey: ['synthetic-assets'], queryFn: api.getSyntheticAssets, refetchInterval: 10_000 });
}

export function useSyntheticAsset(id: string) {
  return useQuery({ queryKey: ['synthetic-asset', id], queryFn: () => api.getSyntheticAsset(id), refetchInterval: 10_000 });
}

export function useVaultState() {
  return useQuery({ queryKey: ['vault-state'], queryFn: api.getVaultState, refetchInterval: 10_000 });
}

export function useSyntheticHistory(userAddress?: string) {
  return useQuery({
    queryKey: ['synthetic-history', userAddress],
    queryFn: () => api.getSyntheticHistory(userAddress),
    refetchInterval: 15_000,
  });
}

// ── Admin Synthetic Queries ────────────────────────────────────────────

export function useAdminSynthetics() {
  return useQuery({ queryKey: ['admin-synthetics'], queryFn: api.getAdminSynthetics });
}

export function useOracleProviders() {
  return useQuery({ queryKey: ['oracle-providers'], queryFn: api.getOracleProviders });
}

// ── Admin Pool Queries ─────────────────────────────────────────────────

export function usePools() {
  return useQuery({ queryKey: ['pools'], queryFn: api.getPools, refetchInterval: 10_000 });
}

export function useAdminPools() {
  return useQuery({ queryKey: ['admin-pools'], queryFn: api.getAdminPools, refetchInterval: 10_000 });
}
