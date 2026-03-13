import { cn, formatUsd, formatPercent, formatNumber, timeAgo } from '@/lib/utils';
import type {
  OperatorDashboardSummary,
  RelayerStatus,
  RiskAlert,
  VenueHealthDetail,
  MarketRiskInfo,
  MarketInfo,
  ExecutionRecord,
} from '@/types';
import { Card, CardHeader, CardTitle, StatCard, Button, Skeleton, Separator } from '@/components/ui/primitives';
import { MarketModeBadge } from '@/components/shared/MarketModeBadge';
import { HealthPill, VenueBadge, ExecutionStatusBadge } from '@/components/shared/StatusIndicators';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Fuel,
  Gauge,
  Heart,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Shield,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react';

// ── Operator Summary Cards ─────────────────────────────────────────────

interface OperatorOverviewProps {
  summary: OperatorDashboardSummary;
  className?: string;
}

export function OperatorOverview({ summary, className }: OperatorOverviewProps) {
  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3', className)}>
      <StatCard
        label="Active Markets"
        value={`${summary.activeMarkets} / ${summary.totalMarkets}`}
        icon={<BarChart3 size={14} />}
        status={summary.pausedMarkets > 0 ? 'warning' : 'success'}
      />
      <StatCard
        label="Success Rate (24h)"
        value={formatPercent(summary.routeSuccessRate24h)}
        icon={<TrendingUp size={14} />}
        status={summary.routeSuccessRate24h > 95 ? 'success' : summary.routeSuccessRate24h > 85 ? 'warning' : 'error'}
      />
      <StatCard
        label="Relayer Inventory"
        value={formatUsd(summary.relayerInventoryUsd)}
        icon={<Wallet size={14} />}
        status={summary.relayerOnline ? 'success' : 'error'}
      />
      <StatCard
        label="Synthetic Exposure"
        value={formatUsd(summary.syntheticExposureUsd)}
        icon={<Gauge size={14} />}
        status={summary.syntheticCapUtilization > 0.8 ? 'error' : summary.syntheticCapUtilization > 0.5 ? 'warning' : 'default'}
      />
      <StatCard
        label="Executions (24h)"
        value={summary.totalExecutions24h.toString()}
        icon={<Zap size={14} />}
      />
      <StatCard
        label="Failed (24h)"
        value={summary.failedExecutions24h.toString()}
        icon={<XCircle size={14} />}
        status={summary.failedExecutions24h > 0 ? 'error' : 'success'}
      />
      <StatCard
        label="Pending"
        value={summary.pendingExecutions.toString()}
        icon={<Clock size={14} />}
        status={summary.pendingExecutions > 5 ? 'warning' : 'default'}
      />
      <StatCard
        label="Stale Alerts"
        value={summary.staleQuoteAlerts.toString()}
        icon={<AlertTriangle size={14} />}
        status={summary.staleQuoteAlerts > 0 ? 'warning' : 'success'}
      />
    </div>
  );
}

// ── Relayer Status Card ────────────────────────────────────────────────

interface RelayerStatusCardProps {
  relayer: RelayerStatus;
  className?: string;
}

export function RelayerStatusCard({ relayer, className }: RelayerStatusCardProps) {
  return (
    <Card className={cn('p-5 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <CardTitle className="text-base">Relayer Status</CardTitle>
        <div className="flex items-center gap-2">
          {relayer.online ? (
            <span className="flex items-center gap-1 text-xs text-health-healthy font-medium">
              <Wifi size={12} /> Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-health-down font-medium">
              <WifiOff size={12} /> Offline
            </span>
          )}
        </div>
      </div>

      {/* Chain Balances */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">Chain Balances</div>
        {(relayer.chains ?? []).map((chain) => (
          <div key={chain.chain} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full',
                chain.connected ? 'bg-health-healthy' : 'bg-health-down',
              )} />
              <span className="text-sm font-medium capitalize">{chain.chain}</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono">{chain.balance}</div>
              <div className="text-xs text-muted-foreground">{formatUsd(chain.balanceUsd)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 text-center pt-2 border-t border-border">
        <div>
          <div className="text-xs text-muted-foreground">Total Inventory</div>
          <div className="text-sm font-bold">{formatUsd(relayer.totalInventoryUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Exposure</div>
          <div className="text-sm font-bold">{formatUsd(relayer.totalExposureUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg Latency</div>
          <div className="text-sm font-bold">{(relayer.avgLatencyMs / 1000).toFixed(1)}s</div>
        </div>
      </div>

      {/* Recent Fills */}
      {(relayer.recentFills ?? []).length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Recent Fills</div>
          {(relayer.recentFills ?? []).map((fill) => (
            <div key={fill.executionId} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{fill.executionId.slice(0, 12)}</span>
                <span className="font-medium">{fill.amount}</span>
              </div>
              <span className="text-muted-foreground">{timeAgo(fill.completedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Risk Alert List ────────────────────────────────────────────────────

interface RiskAlertListProps {
  alerts: RiskAlert[];
  className?: string;
}

export function RiskAlertList({ alerts, className }: RiskAlertListProps) {
  return (
    <Card className={cn('p-5 space-y-3', className)}>
      <CardTitle className="text-base">Risk Alerts</CardTitle>
      {(alerts ?? []).length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <CheckCircle2 size={16} className="text-health-healthy" />
          No active alerts
        </div>
      ) : (
        <div className="space-y-2">
          {(alerts ?? []).map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border',
                alert.severity === 'critical' && 'bg-health-down/10 border-health-down/20',
                alert.severity === 'warning' && 'bg-health-degraded/10 border-health-degraded/20',
                alert.severity === 'info' && 'bg-secondary/50 border-border',
                alert.acknowledged && 'opacity-60',
              )}
            >
              <AlertTriangle
                size={14}
                className={cn(
                  'mt-0.5 shrink-0',
                  alert.severity === 'critical' && 'text-health-down',
                  alert.severity === 'warning' && 'text-health-degraded',
                  alert.severity === 'info' && 'text-muted-foreground',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {alert.category}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(alert.createdAt)}</span>
                </div>
                <p className="text-sm mt-0.5">{alert.message}</p>
                {alert.details && <p className="text-xs text-muted-foreground mt-1">{alert.details}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Venue Health Table ─────────────────────────────────────────────────

interface VenueHealthTableProps {
  venues: VenueHealthDetail[];
  className?: string;
}

export function VenueHealthTable({ venues, className }: VenueHealthTableProps) {
  return (
    <Card className={cn('p-5 space-y-3', className)}>
      <CardTitle className="text-base">Venue Health</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
              <th className="text-left pb-2 font-medium">Venue</th>
              <th className="text-left pb-2 font-medium">Health</th>
              <th className="text-right pb-2 font-medium">Latency</th>
              <th className="text-right pb-2 font-medium">Quotes 24h</th>
              <th className="text-right pb-2 font-medium">Errors 24h</th>
              <th className="text-right pb-2 font-medium">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {(venues ?? []).map((venue) => (
              <tr key={venue.venueId} className="border-b border-border/50 last:border-0">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <VenueBadge venueType={venue.venueType} />
                    <span className="font-medium">{venue.venueName}</span>
                  </div>
                </td>
                <td className="py-2.5"><HealthPill health={venue.health} /></td>
                <td className={cn(
                  'py-2.5 text-right font-mono',
                  venue.latencyMs < 100 ? 'text-health-healthy' : venue.latencyMs < 300 ? 'text-health-degraded' : 'text-health-down',
                )}>
                  {venue.latencyMs}ms
                </td>
                <td className="py-2.5 text-right font-mono">{formatNumber(venue.quotesServed24h)}</td>
                <td className={cn(
                  'py-2.5 text-right font-mono',
                  venue.errorCount24h > 5 ? 'text-health-down' : venue.errorCount24h > 0 ? 'text-health-degraded' : '',
                )}>
                  {venue.errorCount24h}
                </td>
                <td className="py-2.5 text-right font-mono">{formatPercent(venue.uptime24h * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Market Status Table ────────────────────────────────────────────────

interface MarketStatusTableProps {
  markets: MarketInfo[];
  risks?: MarketRiskInfo[];
  onTogglePause?: (pairId: string) => void;
  className?: string;
}

export function MarketStatusTable({ markets, risks, onTogglePause, className }: MarketStatusTableProps) {
  const riskMap = new Map(risks?.map((r) => [r.pairId, r]));

  return (
    <Card className={cn('p-5 space-y-3', className)}>
      <CardTitle className="text-base">Markets</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
              <th className="text-left pb-2 font-medium">Pair</th>
              <th className="text-left pb-2 font-medium">Mode</th>
              <th className="text-left pb-2 font-medium">Status</th>
              <th className="text-right pb-2 font-medium">Volume 24h</th>
              <th className="text-right pb-2 font-medium">Sources</th>
              <th className="text-right pb-2 font-medium">Circuit Breaker</th>
              <th className="text-right pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(markets ?? []).map((market) => {
              const risk = riskMap.get(market.pairId);
              return (
                <tr key={market.pairId} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 font-semibold">{market.pairId}</td>
                  <td className="py-2.5">
                    <MarketModeBadge mode={market.primaryMode ?? 'native'} size="sm" />
                  </td>
                  <td className="py-2.5">
                    <HealthPill health={market.status === 'active' ? 'healthy' : market.status === 'paused' ? 'down' : 'degraded'} />
                  </td>
                  <td className="py-2.5 text-right font-mono">{formatUsd(market.volume24h ?? 0)}</td>
                  <td className="py-2.5 text-right">
                    {(market.sources ?? []).filter((s) => s.health === 'healthy').length}/{(market.sources ?? []).length}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={cn(
                      'text-xs',
                      !market.circuitBreaker || market.circuitBreaker === 'none' ? 'text-muted-foreground' : 'text-health-down font-medium',
                    )}>
                      {!market.circuitBreaker || market.circuitBreaker === 'none' ? 'Off' : market.circuitBreaker.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => onTogglePause?.(market.pairId)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                        market.status === 'active'
                          ? 'text-health-degraded hover:bg-health-degraded/10'
                          : 'text-health-healthy hover:bg-health-healthy/10',
                      )}
                    >
                      {market.status === 'active' ? <><Pause size={10} /> Pause</> : <><Play size={10} /> Resume</>}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Execution Monitor Table ────────────────────────────────────────────

interface ExecutionMonitorTableProps {
  executions: ExecutionRecord[];
  onSelect?: (id: string) => void;
  className?: string;
}

export function ExecutionMonitorTable({ executions, onSelect, className }: ExecutionMonitorTableProps) {
  return (
    <Card className={cn('p-5 space-y-3', className)}>
      <CardTitle className="text-base">Executions</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
              <th className="text-left pb-2 font-medium">ID</th>
              <th className="text-left pb-2 font-medium">Pair</th>
              <th className="text-left pb-2 font-medium">Mode</th>
              <th className="text-left pb-2 font-medium">Status</th>
              <th className="text-right pb-2 font-medium">Amount</th>
              <th className="text-right pb-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(executions ?? []).map((exec) => (
              <tr
                key={exec.executionId}
                onClick={() => onSelect?.(exec.executionId)}
                className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-accent/50 transition-colors"
              >
                <td className="py-2.5 font-mono text-xs text-muted-foreground">{exec.executionId}</td>
                <td className="py-2.5 font-semibold">{exec.pairId}</td>
                <td className="py-2.5"><MarketModeBadge mode={exec.mode} size="sm" /></td>
                <td className="py-2.5"><ExecutionStatusBadge status={exec.status} /></td>
                <td className="py-2.5 text-right font-mono">{exec.inputAmount} {exec.inputToken?.symbol}</td>
                <td className="py-2.5 text-right text-xs text-muted-foreground">{timeAgo(exec.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Synthetic Exposure Card ────────────────────────────────────────────

interface SyntheticExposureCardProps {
  summary: OperatorDashboardSummary;
  marketRisks: MarketRiskInfo[];
  className?: string;
}

export function SyntheticExposureCard({ summary, marketRisks, className }: SyntheticExposureCardProps) {
  const syntheticMarkets = marketRisks.filter((m) => m.syntheticCapTotal);
  const capPct = summary.syntheticCapUtilization * 100;

  return (
    <Card className={cn('p-5 space-y-4', className)}>
      <CardTitle className="text-base">Synthetic Exposure</CardTitle>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total Exposure</span>
          <span className="font-bold">{formatUsd(summary.syntheticExposureUsd)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Cap Utilization</span>
          <span className={cn(
            'font-bold',
            capPct > 80 ? 'text-health-down' : capPct > 50 ? 'text-health-degraded' : 'text-health-healthy',
          )}>
            {formatPercent(capPct)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              capPct > 80 ? 'bg-health-down' : capPct > 50 ? 'bg-health-degraded' : 'bg-health-healthy',
            )}
            style={{ width: `${Math.min(capPct, 100)}%` }}
          />
        </div>
      </div>

      {syntheticMarkets.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Per-Market Caps</div>
          {syntheticMarkets.map((m) => (
            <div key={m.pairId} className="flex items-center justify-between text-xs">
              <span className="font-medium">{m.pairId}</span>
              <span className="font-mono">
                {formatUsd(m.syntheticCapUsed ?? 0)} / {formatUsd(m.syntheticCapTotal ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
