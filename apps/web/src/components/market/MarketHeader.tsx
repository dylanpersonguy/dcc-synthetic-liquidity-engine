import { cn, formatUsd, formatPercent } from '@/lib/utils';
import type { MarketInfo } from '@/types';
import { MarketModeBadge } from '@/components/shared/MarketModeBadge';
import { HealthPill } from '@/components/shared/StatusIndicators';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface MarketHeaderProps {
  market: MarketInfo;
  className?: string;
}

export function MarketHeader({ market, className }: MarketHeaderProps) {
  const [baseSymbol, quoteSymbol] = (market.pairId ?? '').split('/');
  const change = market.change24h ?? 0;
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center gap-4', className)}>
      {/* Pair Name */}
      <div className="flex items-center gap-3">
        <div className="flex -space-x-1.5">
          <div className="w-9 h-9 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-bold">
            {(market.baseToken?.symbol ?? baseSymbol ?? '??').slice(0, 2)}
          </div>
          <div className="w-9 h-9 rounded-full bg-secondary border-2 border-background flex items-center justify-center text-xs font-bold">
            {(market.quoteToken?.symbol ?? quoteSymbol ?? '??').slice(0, 2)}
          </div>
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{market.pairId}</h1>
          <p className="text-xs text-muted-foreground">
            {market.baseToken?.name ?? baseSymbol} / {market.quoteToken?.name ?? quoteSymbol}
          </p>
        </div>
      </div>

      {/* Mode Badges */}
      <div className="flex items-center gap-2">
        {market.supportedModes.map((mode) => (
          <MarketModeBadge
            key={mode}
            mode={mode}
            size="sm"
            showIcon
          />
        ))}
      </div>

      {/* Price + Change */}
      <div className="flex items-center gap-4 sm:ml-auto">
        <div className="text-right">
          <div className="text-2xl font-bold font-mono tracking-tight">
            {market.lastPrice < 0.01
              ? market.lastPrice.toFixed(6)
              : market.lastPrice < 1
                ? market.lastPrice.toFixed(4)
                : formatUsd(market.lastPrice)}
          </div>
          <div
            className={cn(
              'flex items-center gap-1 text-sm font-medium',
              isPositive && 'text-health-healthy',
              isNegative && 'text-health-down',
              !isPositive && !isNegative && 'text-muted-foreground',
            )}
          >
            {isPositive && <ArrowUp size={14} />}
            {isNegative && <ArrowDown size={14} />}
            {!isPositive && !isNegative && <Minus size={14} />}
            {formatPercent(Math.abs(change))} (24h)
          </div>
        </div>

        {/* Status */}
        <div className="flex flex-col items-end gap-1">
          <HealthPill health={market.status === 'active' ? 'healthy' : market.status === 'paused' ? 'down' : 'degraded'} />
          {market.circuitBreaker !== 'none' && (
            <span className="text-[10px] text-health-down font-medium">
              Circuit Breaker: {market.circuitBreaker.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
