import { cn, formatUsd, formatNumber } from '@/lib/utils';
import type { MarketInfo } from '@/types';
import { StatCard } from '@/components/ui/primitives';
import {
  Droplets,
  BarChart3,
  Timer,
  Radio,
  ShieldCheck,
} from 'lucide-react';

interface MarketStatsGridProps {
  market: MarketInfo;
  className?: string;
}

export function MarketStatsGrid({ market, className }: MarketStatsGridProps) {
  const totalLiquidity = market.localLiquidity + market.externalLiquidity;
  const settlementLabel =
    market.primaryMode === 'teleport'
      ? '~2 min'
      : market.primaryMode === 'native'
        ? '~4 sec'
        : '~30 sec';

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-5 gap-3', className)}>
      <StatCard
        label="Total Liquidity"
        value={formatUsd(totalLiquidity)}
        icon={<Droplets size={14} />}
        status={totalLiquidity > 500_000 ? 'success' : totalLiquidity > 100_000 ? 'default' : 'warning'}
      />
      <StatCard
        label="24h Volume"
        value={formatUsd(market.volume24h)}
        icon={<BarChart3 size={14} />}
      />
      <StatCard
        label="Max Route Size"
        value={`${formatNumber(market.maxSafeRouteSize)} ${market.baseToken?.symbol ?? market.pairId?.split('/')[0] ?? ''}`}
        icon={<ShieldCheck size={14} />}
      />
      <StatCard
        label="Settlement"
        value={settlementLabel}
        icon={<Timer size={14} />}
      />
      <StatCard
        label="Sources"
        value={`${market.sources.filter((s) => s.enabled).length} active`}
        icon={<Radio size={14} />}
        status={market.sources.some((s) => s.health === 'down') ? 'error' : market.sources.some((s) => s.health === 'degraded') ? 'warning' : 'success'}
      />
    </div>
  );
}
