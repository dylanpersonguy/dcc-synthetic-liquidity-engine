import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { WalletButton } from '@/components/wallet/WalletButton';
import { SeedLoginModal } from '@/components/wallet/SeedLoginModal';
import {
  ArrowLeftRight,
  BarChart3,
  Activity,
  Shield,
  Settings,
  Radio,
  Zap,
  LayoutDashboard,
  Coins,
  Database,
} from 'lucide-react';

// ── Public Layout ──────────────────────────────────────────────────────

const PUBLIC_NAV = [
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { to: '/markets', label: 'Markets', icon: BarChart3 },
  { to: '/synthetics', label: 'Synthetics', icon: Coins },
  { to: '/executions', label: 'History', icon: Activity },
];

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap size={14} className="text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight text-sm">
              DCC <span className="text-muted-foreground font-normal">Liquidity</span>
            </span>
          </NavLink>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )
                }
              >
                <item.icon size={14} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <NavLink
              to="/admin"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border"
            >
              <Settings size={12} />
              Admin
            </NavLink>
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4">
        <Outlet />
      </main>

      <SeedLoginModal />
    </div>
  );
}

// ── Admin Layout ───────────────────────────────────────────────────────

const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/markets', label: 'Markets', icon: BarChart3 },
  { to: '/admin/executions', label: 'Executions', icon: Activity },
  { to: '/admin/relayer', label: 'Relayer', icon: Radio },
  { to: '/admin/risk', label: 'Risk', icon: Shield },
  { to: '/admin/venues', label: 'Venues', icon: Zap },
  { to: '/admin/synthetics', label: 'Synthetics', icon: Database },
  { to: '/admin/pools', label: 'Pools', icon: Coins },
];

export function AdminLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border/50 bg-card/50 sticky top-0 h-screen overflow-y-auto">
        <div className="p-4">
          <NavLink to="/" className="flex items-center gap-2 mb-6">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap size={14} className="text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight text-sm">
              DCC <span className="text-muted-foreground font-normal">Admin</span>
            </span>
          </NavLink>

          <nav className="space-y-1">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )
                }
              >
                <item.icon size={14} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-4 mt-auto border-t border-border/50">
          <WalletButton />
          <NavLink
            to="/swap"
            className="flex items-center gap-2 px-3 py-2 mt-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeftRight size={14} />
            Back to App
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-5xl">
        <Outlet />
      </main>

      <SeedLoginModal />
    </div>
  );
}
