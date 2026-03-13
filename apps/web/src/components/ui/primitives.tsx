import { cn } from '@/lib/utils';

// ── Card ───────────────────────────────────────────────────────────────

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass-panel-solid p-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center justify-between mb-3', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn('text-sm font-semibold text-foreground', className)}>{children}</h3>;
}

// ── Stat Card ──────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  subValue,
  status,
  icon,
  className,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  status?: 'positive' | 'negative' | 'neutral' | 'warning' | 'success' | 'error' | 'default';
  icon?: React.ReactNode;
  className?: string;
}) {
  const statusColors: Record<string, string> = {
    positive: 'text-green-400',
    success: 'text-green-400',
    negative: 'text-red-400',
    error: 'text-red-400',
    neutral: 'text-muted-foreground',
    default: 'text-muted-foreground',
    warning: 'text-amber-400',
  };

  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <span className="stat-label flex items-center gap-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {label}
      </span>
      <span className={cn('stat-value', status && statusColors[status])}>{value}</span>
      {subValue && (
        <span className={cn('text-xs', status ? statusColors[status] : 'text-muted-foreground')}>
          {subValue}
        </span>
      )}
    </Card>
  );
}

// ── Button ─────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className, children, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-accent',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-base gap-2',
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={disabled} {...props}>
      {children}
    </button>
  );
}

// ── Input ──────────────────────────────────────────────────────────────

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

// ── Separator ──────────────────────────────────────────────────────────

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />;
}

// ── Tabs (simple) ──────────────────────────────────────────────────────

export function TabList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('inline-flex items-center gap-1 p-1 rounded-lg bg-secondary/50', className)}>
      {children}
    </div>
  );
}

export function Tab({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
