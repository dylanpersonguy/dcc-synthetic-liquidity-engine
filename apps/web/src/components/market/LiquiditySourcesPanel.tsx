import { cn, timeAgo } from '@/lib/utils';
import type { VenueSource } from '@/types';
import { HealthPill, VenueBadge } from '@/components/shared/StatusIndicators';
import { Card, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Activity, Clock, AlertCircle } from 'lucide-react';

interface LiquiditySourceCardProps {
  source: VenueSource;
  className?: string;
}

export function LiquiditySourceCard({ source, className }: LiquiditySourceCardProps) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <VenueBadge venueType={source.venueType} />
          <span className="text-sm font-semibold">{source.venueName}</span>
        </div>
        <HealthPill health={source.health} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <Activity size={10} />
            <span className="text-[10px] uppercase tracking-wider">Latency</span>
          </div>
          <span className={cn(
            'text-sm font-mono font-semibold',
            source.latencyMs < 100 ? 'text-health-healthy' : source.latencyMs < 300 ? 'text-health-degraded' : 'text-health-down',
          )}>
            {source.latencyMs}ms
          </span>
        </div>

        <div>
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <Clock size={10} />
            <span className="text-[10px] uppercase tracking-wider">Last Quote</span>
          </div>
          <span className="text-sm font-mono">{timeAgo(source.lastQuoteAt)}</span>
        </div>

        <div>
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <AlertCircle size={10} />
            <span className="text-[10px] uppercase tracking-wider">Errors 24h</span>
          </div>
          <span className={cn(
            'text-sm font-mono font-semibold',
            source.errorCount24h === 0 ? 'text-health-healthy' : source.errorCount24h < 5 ? 'text-health-degraded' : 'text-health-down',
          )}>
            {source.errorCount24h}
          </span>
        </div>
      </div>

      {!source.enabled && (
        <div className="mt-3 text-center text-xs text-muted-foreground bg-secondary/50 rounded px-2 py-1">
          Disabled
        </div>
      )}
    </Card>
  );
}

interface LiquiditySourcesPanelProps {
  sources: VenueSource[];
  className?: string;
}

export function LiquiditySourcesPanel({ sources, className }: LiquiditySourcesPanelProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <CardHeader className="px-0 pt-0">
        <CardTitle>Liquidity Sources</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sources.map((source) => (
          <LiquiditySourceCard key={source.venueId} source={source} />
        ))}
      </div>
    </div>
  );
}
