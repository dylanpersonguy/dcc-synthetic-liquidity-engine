import { useParams } from 'react-router-dom';
import { useMarket } from '@/hooks/use-queries';
import { MarketHeader } from '@/components/market/MarketHeader';
import { MarketStatsGrid } from '@/components/market/MarketStatsGrid';
import { LiquiditySourcesPanel } from '@/components/market/LiquiditySourcesPanel';
import { ModeExplainer } from '@/components/market/ModeExplainer';
import { SwapPanel } from '@/components/swap/SwapPanel';
import { Skeleton } from '@/components/ui/primitives';

export function MarketDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const pairId = (slug ?? '').replace('-', '/').toUpperCase();
  const { data: market, isLoading } = useMarket(pairId);

  if (isLoading) {
    return (
      <div className="py-8 space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-xl font-bold">Market Not Found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          No market found for pair "{pairId}".
        </p>
      </div>
    );
  }

  return (
    <div className="py-8 space-y-8">
      <MarketHeader market={market} />
      <MarketStatsGrid market={market} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: liquidity + mode info */}
        <div className="lg:col-span-2 space-y-8">
          <LiquiditySourcesPanel sources={market.sources} />
          <ModeExplainer
            modes={market.supportedModes}
            primaryMode={market.primaryMode}
          />
        </div>

        {/* Right column: embedded swap */}
        <div>
          <div className="sticky top-24">
            <SwapPanel market={market} />
          </div>
        </div>
      </div>
    </div>
  );
}
