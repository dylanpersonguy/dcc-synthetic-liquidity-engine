import { cn } from '@/lib/utils';
import type { QuoteResponse } from '@/types';
import { MarketModeBadge } from '@/components/shared/MarketModeBadge';
import { ConfidenceIndicator, VenueBadge } from '@/components/shared/StatusIndicators';
import { Card, Separator } from '@/components/ui/primitives';
import { useCountdown } from '@/hooks/use-utils';
import {
  ArrowRight,
  Clock,
  Shield,
  Timer,
} from 'lucide-react';

interface RoutePreviewCardProps {
  quote: QuoteResponse;
  className?: string;
}

export function RoutePreviewCard({ quote, className }: RoutePreviewCardProps) {
  const countdown = useCountdown(quote.expiresAt);
  const isExpired = countdown <= 0;

  return (
    <Card className={cn('space-y-3', isExpired && 'opacity-60', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">Best Route</span>
          <MarketModeBadge mode={quote.mode} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceIndicator confidence={quote.confidence} score={quote.confidenceScore} />
        </div>
      </div>

      {/* Route Legs */}
      <div className="space-y-0">
        {quote.legs.map((leg, i) => (
          <div key={leg.index} className="flex items-center gap-2 py-2">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
              {i + 1}
            </div>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm font-medium">{leg.tokenIn}</span>
              <ArrowRight size={12} className="text-muted-foreground" />
              <span className="text-sm font-medium">{leg.tokenOut}</span>
            </div>
            <VenueBadge venueType={leg.venueType} />
          </div>
        ))}
      </div>

      <Separator />

      {/* Footer Stats */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock size={12} />
            {quote.estimatedSettlementMs < 10_000
              ? 'Instant'
              : `~${Math.ceil(quote.estimatedSettlementMs / 60_000)} min`}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Timer size={12} />
            {isExpired ? (
              <span className="text-red-400">Expired</span>
            ) : (
              <span>{countdown}s left</span>
            )}
          </span>
        </div>
        {quote.legs.length > 1 && (
          <span className="text-muted-foreground">{quote.legs.length} legs</span>
        )}
      </div>

      {/* Warnings */}
      {quote.warnings.length > 0 && (
        <div className="space-y-1">
          {quote.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-400/80 leading-tight">{w}</p>
          ))}
        </div>
      )}
    </Card>
  );
}
