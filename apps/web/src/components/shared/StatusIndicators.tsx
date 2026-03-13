import { cn } from '@/lib/utils';
import type { VenueHealth, QuoteConfidence } from '@/types';

// ── Health Pill ────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<VenueHealth, { label: string; dot: string; text: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-health-healthy', text: 'text-health-healthy' },
  degraded: { label: 'Degraded', dot: 'bg-health-degraded', text: 'text-health-degraded' },
  down: { label: 'Down', dot: 'bg-health-down', text: 'text-health-down' },
};

export function HealthPill({ health, className }: { health: VenueHealth; className?: string }) {
  const config = HEALTH_CONFIG[health];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.text, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot, health === 'healthy' && 'animate-pulse')} />
      {config.label}
    </span>
  );
}

// ── Confidence Indicator ───────────────────────────────────────────────

const CONFIDENCE_CONFIG: Record<QuoteConfidence, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: 'text-confidence-high', bg: 'bg-confidence-high' },
  medium: { label: 'Medium', color: 'text-confidence-medium', bg: 'bg-confidence-medium' },
  low: { label: 'Low', color: 'text-confidence-low', bg: 'bg-confidence-low' },
};

export function ConfidenceIndicator({
  confidence,
  score,
  className,
}: {
  confidence: QuoteConfidence;
  score?: number;
  className?: string;
}) {
  const config = CONFIDENCE_CONFIG[confidence];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'h-3 w-1 rounded-full',
              i <= (['high', 'medium', 'low'].indexOf(confidence) === 0 ? 2 : confidence === 'medium' ? 1 : 0)
                ? config.bg
                : 'bg-muted',
            )}
          />
        ))}
      </div>
      <span className={cn('text-xs font-medium', config.color)}>
        {config.label}
        {score !== undefined && <span className="text-muted-foreground ml-1">({(score * 100).toFixed(0)}%)</span>}
      </span>
    </div>
  );
}

// ── Venue Badge ────────────────────────────────────────────────────────

import type { VenueType } from '@/types';

const VENUE_LABELS: Record<VenueType, string> = {
  dcc_amm: 'DCC AMM',
  dcc_orderbook: 'DCC Book',
  jupiter: 'Jupiter',
  raydium: 'Raydium',
  uniswap: 'Uniswap',
};

const VENUE_CHAINS: Record<VenueType, string> = {
  dcc_amm: 'DCC',
  dcc_orderbook: 'DCC',
  jupiter: 'Solana',
  raydium: 'Solana',
  uniswap: 'Ethereum',
};

export function VenueBadge({
  venueType,
  health,
  className,
}: {
  venueType: VenueType;
  health?: VenueHealth;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium',
        'bg-secondary text-secondary-foreground border border-border/50',
        className,
      )}
    >
      {health && <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_CONFIG[health].dot)} />}
      {VENUE_LABELS[venueType]}
      <span className="text-muted-foreground">· {VENUE_CHAINS[venueType]}</span>
    </span>
  );
}

// ── Warning Banner ─────────────────────────────────────────────────────

import { AlertTriangle, Info, XCircle } from 'lucide-react';

export function WarningBanner({
  severity = 'warning',
  children,
  className,
}: {
  severity?: 'info' | 'warning' | 'error';
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    error: 'bg-red-500/10 border-red-500/30 text-red-400',
  };
  const icons = { info: Info, warning: AlertTriangle, error: XCircle };
  const Icon = icons[severity];

  return (
    <div className={cn('flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm', styles[severity], className)}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

// ── Execution Status Badge ─────────────────────────────────────────────

import type { ExecutionStatus } from '@/types';

const STATUS_CONFIG: Record<ExecutionStatus, { label: string; color: string; bg: string }> = {
  quote_created: { label: 'Quote Created', color: 'text-slate-400', bg: 'bg-slate-500/20' },
  route_locked: { label: 'Route Locked', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  local_leg_pending: { label: 'Local Pending', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  local_leg_complete: { label: 'Local Complete', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
  external_leg_pending: { label: 'External Pending', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  external_leg_complete: { label: 'External Complete', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  awaiting_delivery: { label: 'Awaiting Delivery', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  completed: { label: 'Completed', color: 'text-green-400', bg: 'bg-green-500/20' },
  partially_filled: { label: 'Partial Fill', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/20' },
  refunded: { label: 'Refunded', color: 'text-slate-400', bg: 'bg-slate-500/20' },
  expired: { label: 'Expired', color: 'text-slate-400', bg: 'bg-slate-500/20' },
};

export function ExecutionStatusBadge({ status, className }: { status: ExecutionStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold', config.bg, config.color, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.bg.replace('/20', ''))} />
      {config.label}
    </span>
  );
}
