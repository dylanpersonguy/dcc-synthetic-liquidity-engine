import { useVenueHealth } from '@/hooks/use-queries';
import { VenueHealthTable } from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminVenuesPage() {
  const { data: venues, isLoading } = useVenueHealth();

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Venue Health</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor all connected liquidity venues and connectors.</p>
      </div>
      {venues && <VenueHealthTable venues={venues} />}
    </div>
  );
}
