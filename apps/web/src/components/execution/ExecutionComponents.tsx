import { cn, timeAgo, shortenAddress } from '@/lib/utils';
import type { ExecutionRecord, ExecutionStatus } from '@/types';
import { MarketModeBadge } from '@/components/shared/MarketModeBadge';
import { ExecutionStatusBadge } from '@/components/shared/StatusIndicators';
import { Card } from '@/components/ui/primitives';
import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  XCircle,
  RefreshCcw,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';

// ── Progress Timeline ──────────────────────────────────────────────────

interface ExecutionProgressTimelineProps {
  execution: ExecutionRecord;
  className?: string;
}

const STEP_SEQUENCE: { key: string; label: string; relevantStatuses: ExecutionStatus[] }[] = [
  { key: 'quote', label: 'Quote Created', relevantStatuses: ['quote_created'] },
  { key: 'route_lock', label: 'Route Locked', relevantStatuses: ['route_locked'] },
  {
    key: 'local_leg',
    label: 'Local Leg',
    relevantStatuses: ['local_leg_pending', 'local_leg_complete'],
  },
  {
    key: 'external_leg',
    label: 'External Leg',
    relevantStatuses: ['external_leg_pending', 'external_leg_complete'],
  },
  { key: 'delivery', label: 'Delivery', relevantStatuses: ['awaiting_delivery'] },
  { key: 'complete', label: 'Complete', relevantStatuses: ['completed'] },
];

const STATUS_ORDER: ExecutionStatus[] = [
  'quote_created',
  'route_locked',
  'local_leg_pending',
  'local_leg_complete',
  'external_leg_pending',
  'external_leg_complete',
  'awaiting_delivery',
  'completed',
];

function getStepState(stepStatuses: ExecutionStatus[], current: ExecutionStatus) {
  const currentIdx = STATUS_ORDER.indexOf(current);
  if (current === 'failed' || current === 'expired' || current === 'refunded') {
    // Find where the failure happened based on legs
    return 'failed';
  }
  const stepIndices = stepStatuses.map((s) => STATUS_ORDER.indexOf(s));
  const maxStepIdx = Math.max(...stepIndices);
  const minStepIdx = Math.min(...stepIndices);

  if (currentIdx > maxStepIdx) return 'done';
  if (currentIdx >= minStepIdx && currentIdx <= maxStepIdx) return 'active';
  return 'pending';
}

export function ExecutionProgressTimeline({ execution, className }: ExecutionProgressTimelineProps) {
  const isTeleport = execution.mode === 'teleport';
  const steps = isTeleport ? STEP_SEQUENCE : STEP_SEQUENCE.filter((s) => s.key !== 'external_leg' && s.key !== 'delivery');
  const isFailed = ['failed', 'expired', 'refunded'].includes(execution.status);
  const isPartial = execution.status === 'partially_filled';

  return (
    <div className={cn('space-y-1', className)}>
      {steps.map((step, i) => {
        let state: 'done' | 'active' | 'pending' | 'failed';
        if (isFailed) {
          const currentIdx = STATUS_ORDER.indexOf(execution.status as ExecutionStatus);
          const minIdx = Math.min(...step.relevantStatuses.map((s) => STATUS_ORDER.indexOf(s)));
          if (currentIdx >= minIdx) state = 'failed';
          else {
            const maxIdx = Math.max(...step.relevantStatuses.map((s) => STATUS_ORDER.indexOf(s)));
            // Check legs to see if earlier steps completed
            const legsDone = execution.legs.filter(l => l.status === 'confirmed').length;
            if (step.key === 'quote' || step.key === 'route_lock') state = 'done';
            else if (step.key === 'local_leg' && legsDone >= 1) state = 'done';
            else state = 'failed';
          }
        } else {
          state = getStepState(step.relevantStatuses, execution.status);
        }

        return (
          <div key={step.key} className="flex items-start gap-3">
            {/* Icon */}
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center',
                state === 'done' && 'bg-health-healthy/20 text-health-healthy',
                state === 'active' && 'bg-primary/20 text-primary',
                state === 'pending' && 'bg-secondary text-muted-foreground',
                state === 'failed' && 'bg-health-down/20 text-health-down',
              )}>
                {state === 'done' && <CheckCircle2 size={16} />}
                {state === 'active' && <Loader2 size={16} className="animate-spin" />}
                {state === 'pending' && <Circle size={16} />}
                {state === 'failed' && <XCircle size={16} />}
              </div>
              {i < steps.length - 1 && (
                <div className={cn(
                  'w-0.5 h-6 my-1',
                  state === 'done' ? 'bg-health-healthy/40' : 'bg-border',
                )} />
              )}
            </div>

            {/* Label + Sub-info */}
            <div className="flex-1 pb-2">
              <div className={cn(
                'text-sm font-medium',
                state === 'active' && 'text-primary',
                state === 'done' && 'text-foreground',
                state === 'pending' && 'text-muted-foreground',
                state === 'failed' && 'text-health-down',
              )}>
                {step.label}
              </div>
              {/* Show leg details */}
              {step.key === 'local_leg' && execution.legs[0] && (
                <LegDetail leg={execution.legs[0]} />
              )}
              {step.key === 'external_leg' && execution.legs[1] && (
                <LegDetail leg={execution.legs[1]} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LegDetail({ leg }: { leg: ExecutionRecord['legs'][0] }) {
  return (
    <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
      <div className="flex items-center gap-1">
        <span>{leg.venueName}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="capitalize">{leg.chain}</span>
      </div>
      {leg.txHash && (
        <div className="flex items-center gap-1 font-mono">
          <span>{leg.txHash}</span>
          <ExternalLink size={10} className="text-primary" />
        </div>
      )}
      {leg.confirmedAt && <span>{timeAgo(leg.confirmedAt)}</span>}
    </div>
  );
}

// ── Execution Detail Card ──────────────────────────────────────────────

interface ExecutionDetailCardProps {
  execution: ExecutionRecord;
  className?: string;
}

export function ExecutionDetailCard({ execution, className }: ExecutionDetailCardProps) {
  const isFailed = execution.status === 'failed';
  const isComplete = execution.status === 'completed';

  return (
    <Card className={cn('p-5 space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MarketModeBadge mode={execution.mode} size="md" showIcon />
          <div>
            <h3 className="text-sm font-semibold">{execution.pairId}</h3>
            <span className="text-xs text-muted-foreground font-mono">{execution.executionId}</span>
          </div>
        </div>
        <ExecutionStatusBadge status={execution.status} />
      </div>

      {/* Amounts */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
        <div>
          <div className="text-xs text-muted-foreground">Sent</div>
          <div className="text-lg font-bold font-mono">
            {execution.inputAmount} {execution.inputToken.symbol}
          </div>
        </div>
        <ArrowRight size={20} className="text-muted-foreground" />
        <div>
          <div className="text-xs text-muted-foreground">
            {isComplete ? 'Received' : 'Expected'}
          </div>
          <div className="text-lg font-bold font-mono">
            {isComplete && execution.outputAmountActual
              ? `${execution.outputAmountActual} ${execution.outputToken.symbol}`
              : `${execution.outputAmountEstimated} ${execution.outputToken.symbol}`}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <ExecutionProgressTimeline execution={execution} />

      {/* Failure Info */}
      {isFailed && execution.failureReason && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-health-down/10 border border-health-down/20">
          <ShieldAlert size={16} className="text-health-down mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-health-down">Execution Failed</div>
            <p className="text-xs text-muted-foreground mt-0.5">{execution.failureReason}</p>
          </div>
        </div>
      )}

      {/* Refund */}
      {execution.refundEligible && !execution.refundedAt && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-2">
            <RefreshCcw size={14} className="text-primary" />
            <span className="text-sm font-medium">Refund Available</span>
          </div>
          <button className="text-xs font-semibold text-primary hover:underline">
            Request Refund
          </button>
        </div>
      )}

      {/* Escrow Info */}
      {execution.escrowAddress && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-1">
            <span>Escrow:</span>
            <span className="font-mono">{shortenAddress(execution.escrowAddress)}</span>
          </div>
          {execution.escrowExpiresAt && (
            <div>Expires: {new Date(execution.escrowExpiresAt).toLocaleTimeString()}</div>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
        <span>Created {timeAgo(execution.createdAt)}</span>
        {execution.completedAt && <span>Completed {timeAgo(execution.completedAt)}</span>}
      </div>
    </Card>
  );
}

// ── Execution List Item (for lists) ────────────────────────────────────

interface ExecutionListItemProps {
  execution: ExecutionRecord;
  onClick?: () => void;
  className?: string;
}

export function ExecutionListItem({ execution, onClick, className }: ExecutionListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-4 rounded-xl glass-panel hover:bg-accent/50 transition-colors flex items-center gap-4',
        className,
      )}
    >
      <MarketModeBadge mode={execution.mode} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{execution.pairId}</span>
          <span className="text-xs text-muted-foreground font-mono truncate">{execution.executionId}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {execution.inputAmount} {execution.inputToken.symbol} → {execution.outputAmountEstimated} {execution.outputToken.symbol}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <ExecutionStatusBadge status={execution.status} />
        <span className="text-[10px] text-muted-foreground">{timeAgo(execution.updatedAt)}</span>
      </div>
    </button>
  );
}
