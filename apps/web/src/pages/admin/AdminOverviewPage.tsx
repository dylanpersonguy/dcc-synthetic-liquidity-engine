import {
  useOperatorSummary,
  useRelayerStatus,
  useRiskAlerts,
  useVenueHealth,
  useMarketRisks,
} from '@/hooks/use-queries';
import {
  OperatorOverview,
  RelayerStatusCard,
  RiskAlertList,
  VenueHealthTable,
  SyntheticExposureCard,
} from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminOverviewPage() {
  const { data: summary, isLoading: summaryLoading } = useOperatorSummary();
  const { data: relayer, isLoading: relayerLoading } = useRelayerStatus();
  const { data: alerts } = useRiskAlerts();
  const { data: venues } = useVenueHealth();
  const { data: marketRisks } = useMarketRisks();

  if (summaryLoading || relayerLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operator Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">System-wide health and operational metrics.</p>
      </div>

      {summary && <OperatorOverview summary={summary} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {alerts && <RiskAlertList alerts={alerts} />}
          {venues && <VenueHealthTable venues={venues} />}
        </div>
        <div className="space-y-6">
          {relayer && <RelayerStatusCard relayer={relayer} />}
          {summary && marketRisks && (
            <SyntheticExposureCard summary={summary} marketRisks={marketRisks} />
          )}
        </div>
      </div>
    </div>
  );
}
