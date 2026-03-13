import { useMarkets, useMarketRisks } from '@/hooks/use-queries';
import { MarketStatusTable } from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminMarketsPage() {
  const { data: markets, isLoading } = useMarkets();
  const { data: risks } = useMarketRisks();

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Market Operations</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage market status, circuit breakers, and risk parameters.</p>
      </div>
      {markets && <MarketStatusTable markets={markets} risks={risks} />}
    </div>
  );
}
