import { useRelayerStatus } from '@/hooks/use-queries';
import { RelayerStatusCard } from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminRelayerPage() {
  const { data: relayer, isLoading } = useRelayerStatus();

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relayer</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor protocol relayer health, balances, and fill activity.</p>
      </div>
      {relayer && <RelayerStatusCard relayer={relayer} />}
    </div>
  );
}
