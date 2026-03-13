import { useMarkets } from '@/hooks/use-queries';
import { SwapPanel } from '@/components/swap/SwapPanel';
import { Skeleton } from '@/components/ui/primitives';
import { useWallet } from '@/stores/wallet';
import { planRoute, executeRoute } from '@/api/client';
import { useNavigate } from 'react-router-dom';
import type { QuoteResponse } from '@/types';
import { useCallback } from 'react';

export function SwapPage() {
  const { data: markets } = useMarkets();
  const { address } = useWallet();
  const navigate = useNavigate();
  const defaultMarket = markets?.find((m) => m.pairId === 'DCC/SOL') ?? null;

  const handleExecute = useCallback(async (quote: QuoteResponse) => {
    if (!address) return;
    const route = await planRoute({ quoteId: quote.quoteId, pairId: quote.pairId });
    const execution = await executeRoute({
      routeId: route.routeId,
      userAddress: address,
      pairId: quote.pairId,
      amount: quote.inputAmount,
    });
    navigate(`/execution/${execution.executionId}`);
  }, [address, navigate]);

  return (
    <div className="py-8">
      <SwapPanel market={defaultMarket} onExecute={handleExecute} />
    </div>
  );
}
