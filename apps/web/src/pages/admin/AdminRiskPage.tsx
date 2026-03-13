import { useRiskAlerts, useMarketRisks, useOperatorSummary } from '@/hooks/use-queries';
import { RiskAlertList, SyntheticExposureCard } from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminRiskPage() {
  const { data: alerts, isLoading: alertsLoading } = useRiskAlerts();
  const { data: risks } = useMarketRisks();
  const { data: summary } = useOperatorSummary();

  if (alertsLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Risk Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">Active alerts, circuit breakers, and synthetic exposure.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {alerts && <RiskAlertList alerts={alerts} />}
        {summary && risks && <SyntheticExposureCard summary={summary} marketRisks={risks} />}
      </div>
    </div>
  );
}
