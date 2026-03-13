import { Link } from 'react-router-dom';
import { useMarkets } from '@/hooks/use-queries';
import { Card, Skeleton } from '@/components/ui/primitives';
import { MarketModeBadge } from '@/components/shared/MarketModeBadge';
import { HealthPill } from '@/components/shared/StatusIndicators';
import { cn, formatUsd, formatPercent } from '@/lib/utils';
import { ArrowUp, ArrowDown, Minus, ArrowRight } from 'lucide-react';

export function MarketsPage() {
  const { data: markets, isLoading } = useMarkets();

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore available trading pairs across native, synthetic, and cross-chain routes.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {markets?.map((market) => {
            const [baseSymbol, quoteSymbol] = market.pairId.split('/');
            const baseTokenSymbol = market.baseToken?.symbol ?? baseSymbol ?? '??';
            const quoteTokenSymbol = market.quoteToken?.symbol ?? quoteSymbol ?? '??';
            const baseTokenName = market.baseToken?.name ?? baseTokenSymbol;
            const quoteTokenName = market.quoteToken?.name ?? quoteTokenSymbol;
            const change = market.change24h ?? 0;
            const isPositive = change > 0;
            const isNegative = change < 0;

            return (
              <Link
                key={market.pairId}
                to={`/markets/${market.pairId.replace('/', '-').toLowerCase()}`}
                className="block"
              >
                <Card className="p-4 hover:bg-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    {/* Token icons */}
                    <div className="flex -space-x-1.5">
                      <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-bold">
                        {baseTokenSymbol.slice(0, 2)}
                      </div>
                      <div className="w-8 h-8 rounded-full bg-secondary border-2 border-background flex items-center justify-center text-xs font-bold">
                        {quoteTokenSymbol.slice(0, 2)}
                      </div>
                    </div>

                    {/* Name + mode */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{market.pairId}</span>
                        <MarketModeBadge mode={market.primaryMode} size="sm" />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {baseTokenName} / {quoteTokenName}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono">
                        {(market.lastPrice ?? 0) < 0.01
                          ? (market.lastPrice ?? 0).toFixed(6)
                          : (market.lastPrice ?? 0) < 1
                            ? (market.lastPrice ?? 0).toFixed(4)
                            : formatUsd(market.lastPrice ?? 0)}
                      </div>
                      <div className={cn(
                        'flex items-center justify-end gap-0.5 text-xs font-medium',
                        isPositive && 'text-health-healthy',
                        isNegative && 'text-health-down',
                        !isPositive && !isNegative && 'text-muted-foreground',
                      )}>
                        {isPositive && <ArrowUp size={10} />}
                        {isNegative && <ArrowDown size={10} />}
                        {!isPositive && !isNegative && <Minus size={10} />}
                        {formatPercent(Math.abs(change))}
                      </div>
                    </div>

                    {/* Volume */}
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-muted-foreground">Volume 24h</div>
                      <div className="text-sm font-mono">{formatUsd(market.volume24h ?? 0)}</div>
                    </div>

                    {/* Status */}
                    <div className="hidden md:block">
                      <HealthPill health={market.status === 'active' ? 'healthy' : 'degraded'} />
                    </div>

                    <ArrowRight size={16} className="text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
