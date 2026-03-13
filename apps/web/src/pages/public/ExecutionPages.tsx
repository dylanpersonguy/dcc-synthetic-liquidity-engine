import { useParams, Link } from 'react-router-dom';
import { useExecution, useExecutions } from '@/hooks/use-queries';
import { ExecutionDetailCard, ExecutionListItem } from '@/components/execution/ExecutionComponents';
import { Skeleton, Card, CardTitle } from '@/components/ui/primitives';
import { ArrowLeft } from 'lucide-react';

export function ExecutionDetailPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const { data: execution, isLoading } = useExecution(executionId ?? '');

  if (isLoading) {
    return (
      <div className="py-8 max-w-xl mx-auto">
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-xl font-bold">Execution Not Found</h2>
        <p className="text-sm text-muted-foreground mt-1">ID: {executionId}</p>
      </div>
    );
  }

  return (
    <div className="py-8 max-w-xl mx-auto space-y-4">
      <Link to="/swap" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Back to Swap
      </Link>
      <ExecutionDetailCard execution={execution} />
    </div>
  );
}

export function ExecutionsListPage() {
  const { data: executions, isLoading } = useExecutions();

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recent Executions</h1>
        <p className="text-sm text-muted-foreground mt-1">Track your swap history and execution status.</p>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {executions?.map((exec) => (
            <Link key={exec.executionId} to={`/execution/${exec.executionId}`}>
              <ExecutionListItem execution={exec} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
