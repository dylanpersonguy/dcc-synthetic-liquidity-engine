import { useExecutions } from '@/hooks/use-queries';
import { ExecutionMonitorTable } from '@/components/admin/AdminComponents';
import { Skeleton } from '@/components/ui/primitives';

export function AdminExecutionsPage() {
  const { data: executions, isLoading } = useExecutions();

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Execution Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">Track all in-flight and historical route executions.</p>
      </div>
      {executions && <ExecutionMonitorTable executions={executions} />}
    </div>
  );
}
