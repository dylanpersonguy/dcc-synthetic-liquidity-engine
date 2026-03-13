import { useState, useMemo } from 'react';
import { useAdminPools, useAdminSynthetics } from '@/hooks/use-queries';
import {
  createAdminPool,
  addLiquidityToPool,
  updatePoolConfig,
  setPoolStatus,
} from '@/api/client';
import { signAddLiquidity } from '@/lib/dcc-signer';
import { useWallet } from '@/stores/wallet';
import {
  Card,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Skeleton,
  TabList,
  Tab,
  Separator,
} from '@/components/ui/primitives';
import { cn, formatUsd, formatNumber } from '@/lib/utils';
import type {
  AdminPool,
  PoolStatus,
  CreatePoolRequest,
  AdminSyntheticAsset,
} from '@/types';
import {
  Plus,
  Settings,
  Droplets,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Pause,
  XCircle,
  Coins,
  ArrowRightLeft,
  Users,
  TrendingUp,
  Wallet,
} from 'lucide-react';

// ── Main Page ──────────────────────────────────────────────────────────

export function AdminPoolsPage() {
  const [tab, setTab] = useState<'overview' | 'create' | 'liquidity'>('overview');
  const { data: pools, isLoading, refetch } = useAdminPools();
  const { data: synthetics } = useAdminSynthetics();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Liquidity Pools</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create AMM pools for synthetic assets, seed liquidity, and manage pool configuration.
        </p>
      </div>

      {/* Summary Cards */}
      <PoolSummary pools={pools ?? []} />

      <TabList>
        <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>All Pools</Tab>
        <Tab active={tab === 'create'} onClick={() => setTab('create')}>Create Pool</Tab>
        <Tab active={tab === 'liquidity'} onClick={() => setTab('liquidity')}>Add Liquidity</Tab>
      </TabList>

      {tab === 'overview' && (
        <PoolsOverview pools={pools ?? []} onRefetch={refetch} />
      )}
      {tab === 'create' && (
        <CreatePoolPanel
          synthetics={synthetics ?? []}
          onCreated={() => { refetch(); setTab('overview'); }}
        />
      )}
      {tab === 'liquidity' && (
        <AddLiquidityPanel pools={pools ?? []} onRefetch={refetch} />
      )}
    </div>
  );
}

// ── Summary Cards ──────────────────────────────────────────────────────

function PoolSummary({ pools }: { pools: AdminPool[] }) {
  const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0);
  const totalVolume = pools.reduce((s, p) => s + p.volume24hUsd, 0);
  const totalFees = pools.reduce((s, p) => s + p.fees24hUsd, 0);
  const activePools = pools.filter(p => p.status === 'ACTIVE').length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: 'Total TVL', value: formatUsd(totalTvl), icon: Coins, color: 'text-green-400' },
        { label: '24h Volume', value: formatUsd(totalVolume), icon: ArrowRightLeft, color: 'text-blue-400' },
        { label: '24h Fees', value: formatUsd(totalFees), icon: TrendingUp, color: 'text-amber-400' },
        { label: 'Active Pools', value: `${activePools} / ${pools.length}`, icon: Droplets, color: 'text-purple-400' },
      ].map(({ label, value, icon: Icon, color }) => (
        <Card key={label}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold mt-0.5">{value}</p>
            </div>
            <Icon size={20} className={color} />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Status / Badge helpers ─────────────────────────────────────────────

const POOL_STATUS_META: Record<PoolStatus, { label: string; color: string; icon: React.ReactNode }> = {
  ACTIVE: { label: 'Active', color: 'text-green-400 bg-green-400/10', icon: <CheckCircle2 size={12} /> },
  PAUSED: { label: 'Paused', color: 'text-amber-400 bg-amber-400/10', icon: <Pause size={12} /> },
  DISABLED: { label: 'Disabled', color: 'text-red-400 bg-red-400/10', icon: <XCircle size={12} /> },
};

function PoolStatusBadge({ status }: { status: PoolStatus }) {
  const meta = POOL_STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', meta.color)}>
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Pools Overview ─────────────────────────────────────────────────────

function PoolsOverview({ pools, onRefetch }: { pools: AdminPool[]; onRefetch: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  async function handleStatusChange(poolId: string, status: PoolStatus) {
    await setPoolStatus(poolId, status);
    onRefetch();
  }

  return (
    <div className="space-y-3">
      {pools.length === 0 && (
        <Card><p className="text-sm text-muted-foreground">No pools created yet. Create one to get started.</p></Card>
      )}
      {pools.map(pool => (
        <PoolRow
          key={pool.poolId}
          pool={pool}
          expanded={expanded === pool.poolId}
          onToggle={() => setExpanded(expanded === pool.poolId ? null : pool.poolId)}
          onStatusChange={handleStatusChange}
          onRefetch={onRefetch}
        />
      ))}
    </div>
  );
}

// ── Pool Row ───────────────────────────────────────────────────────────

function PoolRow({ pool, expanded, onToggle, onStatusChange, onRefetch }: {
  pool: AdminPool;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (poolId: string, status: PoolStatus) => void;
  onRefetch: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    feeRateBps: pool.feeRateBps,
    protocolFeeShareBps: pool.protocolFeeShareBps,
    virtualLiquidityA: pool.virtualLiquidityA,
    virtualLiquidityB: pool.virtualLiquidityB,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updatePoolConfig(pool.poolId, editForm);
    setSaving(false);
    setEditing(false);
    onRefetch();
  }

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Droplets size={18} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{pool.tokenASymbol} / {pool.tokenBSymbol}</span>
              <PoolStatusBadge status={pool.status} />
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>Fee: {pool.feeRateBps} bps</span>
              <span>Protocol: {pool.protocolFeeShareBps / 100}%</span>
              <span>{pool.lpPositions.length} LP{pool.lpPositions.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">TVL</div>
            <div className="text-sm font-medium">{formatUsd(pool.tvlUsd)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">24h Volume</div>
            <div className="text-sm font-medium">{formatUsd(pool.volume24hUsd)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">APR</div>
            <div className={cn('text-sm font-medium', pool.apr > 0 ? 'text-green-400' : 'text-muted-foreground')}>
              {pool.apr.toFixed(2)}%
            </div>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-accent/5">
          {/* Reserves & pool metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Reserve A ({pool.tokenASymbol})</span>
              <div className="font-medium">{formatNumber(parseFloat(pool.reserveA) / 1e8, 4)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Reserve B ({pool.tokenBSymbol})</span>
              <div className="font-medium">{formatNumber(parseFloat(pool.reserveB) / 1e8, 4)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Virtual Liq. A</span>
              <div className="font-medium">{formatNumber(parseFloat(pool.virtualLiquidityA) / 1e8, 4)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Virtual Liq. B</span>
              <div className="font-medium">{formatNumber(parseFloat(pool.virtualLiquidityB) / 1e8, 4)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Total LP Supply</span>
              <div className="font-medium">{formatNumber(parseFloat(pool.totalLpSupply) / 1e8, 4)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">24h Fees</span>
              <div className="font-medium">{formatUsd(pool.fees24hUsd)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Pool ID</span>
              <div className="font-mono text-xs break-all">{pool.poolId}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Created</span>
              <div className="font-medium">{new Date(pool.createdAt).toLocaleDateString()}</div>
            </div>
          </div>

          <Separator />

          {/* LP Positions */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} className="text-muted-foreground" />
              <h4 className="text-xs font-semibold text-muted-foreground">LIQUIDITY PROVIDERS</h4>
            </div>
            <div className="space-y-1.5">
              {pool.lpPositions.map((lp, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {i + 1}
                    </div>
                    <div>
                      <span className="font-mono text-xs">{lp.address}</span>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Seeded: {formatNumber(parseFloat(lp.seedAmountA) / 1e8, 4)} {pool.tokenASymbol} + {formatNumber(parseFloat(lp.seedAmountB) / 1e8, 4)} {pool.tokenBSymbol}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">LP Tokens</div>
                      <div className="text-sm font-medium">{formatNumber(parseFloat(lp.lpTokens) / 1e8, 4)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Share</div>
                      <div className="text-sm font-medium">{lp.sharePercent.toFixed(1)}%</div>
                    </div>
                    <div className="w-20 h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(lp.sharePercent, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)}>
              <Settings size={12} /> {editing ? 'Cancel' : 'Edit Config'}
            </Button>
            {pool.status === 'ACTIVE' && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(pool.poolId, 'PAUSED')}>
                <Pause size={12} /> Pause
              </Button>
            )}
            {pool.status === 'PAUSED' && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(pool.poolId, 'ACTIVE')}>
                <CheckCircle2 size={12} /> Resume
              </Button>
            )}
            {pool.status !== 'DISABLED' && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(pool.poolId, 'DISABLED')}>
                <XCircle size={12} /> Disable
              </Button>
            )}
          </div>

          {/* Edit form */}
          {editing && (
            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="text-sm font-semibold">Edit Pool Configuration</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Fee Rate (bps)</span>
                  <Input
                    type="number"
                    min="1"
                    max="1000"
                    value={editForm.feeRateBps}
                    onChange={e => setEditForm({ ...editForm, feeRateBps: Number(e.target.value) })}
                  />
                  <span className="text-xs text-muted-foreground">{(editForm.feeRateBps / 100).toFixed(2)}%</span>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Protocol Fee Share (bps)</span>
                  <Input
                    type="number"
                    min="0"
                    max="5000"
                    value={editForm.protocolFeeShareBps}
                    onChange={e => setEditForm({ ...editForm, protocolFeeShareBps: Number(e.target.value) })}
                  />
                  <span className="text-xs text-muted-foreground">{(editForm.protocolFeeShareBps / 100).toFixed(1)}% of fees to treasury</span>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Virtual Liq. A ({pool.tokenASymbol})</span>
                  <Input
                    value={editForm.virtualLiquidityA}
                    onChange={e => setEditForm({ ...editForm, virtualLiquidityA: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Virtual Liq. B ({pool.tokenBSymbol})</span>
                  <Input
                    value={editForm.virtualLiquidityB}
                    onChange={e => setEditForm({ ...editForm, virtualLiquidityB: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Config'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Create Pool Tab ────────────────────────────────────────────────────

const NATIVE_TOKENS = [
  { id: 'DCC', symbol: 'DCC', name: 'DCC Token', type: 'native' as const },
  { id: 'DUSD', symbol: 'DUSD', name: 'DUSD Stablecoin', type: 'native' as const },
];

function CreatePoolPanel({ synthetics, onCreated }: {
  synthetics: AdminSyntheticAsset[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePoolRequest>({
    tokenA: '',
    tokenASymbol: '',
    tokenB: '',
    tokenBSymbol: '',
    initialAmountA: '',
    initialAmountB: '',
    feeRateBps: 30,
    protocolFeeShareBps: 1000,
    virtualLiquidityA: '0',
    virtualLiquidityB: '0',
  });
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ poolId: string; lpMinted: string } | null>(null);

  const activeSynthetics = synthetics.filter(s => s.status === 'ACTIVE');

  // Unified token list: native + synthetic
  const allTokens = useMemo(() => [
    ...NATIVE_TOKENS,
    ...activeSynthetics.map(s => ({
      id: s.syntheticAssetId,
      symbol: s.symbol,
      name: s.name,
      type: 'synthetic' as const,
      price: s.markPrice,
    })),
  ], [activeSynthetics]);

  const lpPreview = useMemo(() => {
    const a = parseFloat(form.initialAmountA);
    const b = parseFloat(form.initialAmountB);
    if (!a || !b || a <= 0 || b <= 0) return null;
    return Math.sqrt(a * b).toFixed(2);
  }, [form.initialAmountA, form.initialAmountB]);

  const impliedPrice = useMemo(() => {
    const a = parseFloat(form.initialAmountA);
    const b = parseFloat(form.initialAmountB);
    if (!a || !b || a <= 0 || b <= 0) return null;
    return (a / b).toFixed(4);
  }, [form.initialAmountA, form.initialAmountB]);

  const isValid = form.tokenA && form.tokenB && form.tokenA !== form.tokenB && parseFloat(form.initialAmountA) > 0 && parseFloat(form.initialAmountB) > 0;

  async function handleCreate() {
    setCreating(true);
    const pool = await createAdminPool(form);
    setResult({ poolId: pool.poolId, lpMinted: String(parseFloat(pool.totalLpSupply) / 1e8) });
    setCreating(false);
  }

  if (result) {
    return (
      <Card className="text-center py-8 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
          <CheckCircle2 size={32} className="text-green-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Pool Created!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {form.tokenASymbol} / {form.tokenBSymbol} pool is now live.
          </p>
        </div>
        <div className="bg-accent/30 rounded-xl p-4 max-w-sm mx-auto space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pool ID</span>
            <span className="font-mono text-xs">{result.poolId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">LP Tokens Minted</span>
            <span className="font-bold text-green-400">{formatNumber(parseFloat(result.lpMinted), 2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Initial {form.tokenASymbol}</span>
            <span>{formatNumber(parseFloat(form.initialAmountA), 2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Initial {form.tokenBSymbol}</span>
            <span>{formatNumber(parseFloat(form.initialAmountB), 4)}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          LP tokens represent your share of the pool. They can be redeemed for underlying assets at any time.
        </p>
        <Button onClick={() => { setResult(null); onCreated(); }}>
          Back to Pools
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Token pair selection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Select Token Pair</CardTitle>
          <p className="text-xs text-muted-foreground">Pick any two tokens. You can pair synthetics with native tokens or with each other.</p>
        </CardHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Token A */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Token A</label>
            <div className="grid grid-cols-3 gap-2">
              {allTokens.map(t => {
                const disabled = t.id === form.tokenB;
                return (
                  <button
                    key={`a-${t.id}`}
                    disabled={disabled}
                    onClick={() => setForm({ ...form, tokenA: t.id, tokenASymbol: t.symbol })}
                    className={cn(
                      'p-2 rounded-lg border text-center transition-all',
                      form.tokenA === t.id
                        ? 'border-primary bg-primary/10'
                        : disabled
                        ? 'opacity-30 cursor-not-allowed border-border'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <div className="font-semibold text-sm">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {'price' in t ? formatUsd(t.price) : t.name}
                    </div>
                    {t.type === 'synthetic' && (
                      <span className="text-[10px] text-purple-400">synthetic</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Token B */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Token B</label>
            <div className="grid grid-cols-3 gap-2">
              {allTokens.map(t => {
                const disabled = t.id === form.tokenA;
                return (
                  <button
                    key={`b-${t.id}`}
                    disabled={disabled}
                    onClick={() => setForm({ ...form, tokenB: t.id, tokenBSymbol: t.symbol })}
                    className={cn(
                      'p-2 rounded-lg border text-center transition-all',
                      form.tokenB === t.id
                        ? 'border-primary bg-primary/10'
                        : disabled
                        ? 'opacity-30 cursor-not-allowed border-border'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <div className="font-semibold text-sm">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {'price' in t ? formatUsd(t.price) : t.name}
                    </div>
                    {t.type === 'synthetic' && (
                      <span className="text-[10px] text-purple-400">synthetic</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Initial liquidity */}
      <Card>
        <CardHeader>
          <CardTitle>2. Seed Initial Liquidity</CardTitle>
          <p className="text-xs text-muted-foreground">
            The initial amounts set the starting price. You'll receive LP tokens for this deposit.
          </p>
        </CardHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Amount {form.tokenASymbol}</span>
              <Input
                type="number"
                placeholder="e.g. 500000"
                value={form.initialAmountA}
                onChange={e => setForm({ ...form, initialAmountA: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Amount {form.tokenBSymbol || '?'}</span>
              <Input
                type="number"
                placeholder="e.g. 3125"
                value={form.initialAmountB}
                onChange={e => setForm({ ...form, initialAmountB: e.target.value })}
              />
            </label>
          </div>

          {/* Preview box */}
          {lpPreview && (
            <div className="bg-accent/30 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">PREVIEW</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Implied Price</span>
                  <div className="font-medium">
                    1 {form.tokenBSymbol} = {impliedPrice} {form.tokenASymbol}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">LP Tokens Minted</span>
                  <div className="font-medium text-green-400">
                    {formatNumber(parseFloat(lpPreview), 2)}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Pool Share</span>
                  <div className="font-medium">100% (initial)</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                LP tokens = sqrt(amountA × amountB). As the first LP, you receive 100% of the pool share.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Pool configuration */}
      <Card>
        <CardHeader>
          <CardTitle>3. Pool Configuration</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Swap Fee (bps)</span>
            <Input
              type="number"
              min="1"
              max="1000"
              value={form.feeRateBps}
              onChange={e => setForm({ ...form, feeRateBps: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">{(form.feeRateBps / 100).toFixed(2)}% per swap</span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Protocol Fee Share (bps)</span>
            <Input
              type="number"
              min="0"
              max="5000"
              value={form.protocolFeeShareBps}
              onChange={e => setForm({ ...form, protocolFeeShareBps: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">
              {(form.protocolFeeShareBps / 100).toFixed(1)}% of fees → treasury, {(100 - form.protocolFeeShareBps / 100).toFixed(1)}% → LPs
            </span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Virtual Liq. A ({form.tokenASymbol})</span>
            <Input
              value={form.virtualLiquidityA}
              onChange={e => setForm({ ...form, virtualLiquidityA: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">Phantom depth (no yield)</span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Virtual Liq. B ({form.tokenBSymbol || '?'})</span>
            <Input
              value={form.virtualLiquidityB}
              onChange={e => setForm({ ...form, virtualLiquidityB: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">Smooths price impact</span>
          </label>
        </div>
      </Card>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button onClick={handleCreate} disabled={!isValid || creating} size="lg">
          <Plus size={16} /> {creating ? 'Creating Pool...' : 'Create Pool & Mint LP Tokens'}
        </Button>
        {!isValid && (
          <span className="text-xs text-muted-foreground">
            {!form.tokenA ? 'Select Token A' : !form.tokenB ? 'Select Token B' : form.tokenA === form.tokenB ? 'Tokens must be different' : 'Enter initial liquidity amounts'}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Add Liquidity Tab ──────────────────────────────────────────────────

function AddLiquidityPanel({ pools, onRefetch }: { pools: AdminPool[]; onRefetch: () => void }) {
  const [selectedPoolId, setSelectedPoolId] = useState(pools[0]?.poolId ?? '');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ txId: string; lpMinted: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWallet();

  const selectedPool = pools.find(p => p.poolId === selectedPoolId);

  // Auto-calculate proportional amount B when A changes
  const autoAmountB = useMemo(() => {
    if (!selectedPool || !amountA || parseFloat(amountA) <= 0) return '';
    const ratio = parseFloat(selectedPool.reserveB) / parseFloat(selectedPool.reserveA);
    return (parseFloat(amountA) * ratio).toFixed(6);
  }, [selectedPool, amountA]);

  const SCALE8 = 100_000_000;

  const lpPreview = useMemo(() => {
    if (!selectedPool || !amountA || parseFloat(amountA) <= 0) return null;
    const ratioA = parseFloat(amountA) / parseFloat(selectedPool.reserveA);
    return (parseFloat(selectedPool.totalLpSupply) * ratioA).toFixed(2);
  }, [selectedPool, amountA]);

  const sharePreview = useMemo(() => {
    if (!selectedPool || !lpPreview) return null;
    const newTotal = parseFloat(selectedPool.totalLpSupply) + parseFloat(lpPreview);
    return ((parseFloat(lpPreview) / newTotal) * 100).toFixed(2);
  }, [selectedPool, lpPreview]);

  async function handleAdd() {
    if (!selectedPool || !wallet.address) return;
    setAdding(true);
    setError(null);
    setResult(null);
    try {
      const effectiveB = amountB || autoAmountB;
      const rawA = Math.round(parseFloat(amountA) * SCALE8);
      const rawB = Math.round(parseFloat(effectiveB) * SCALE8);

      // Sign & broadcast via user's wallet — LP tokens go to i.caller
      const txId = await signAddLiquidity(selectedPool.poolId, rawA, rawB, 0);

      const estimatedLp = lpPreview ?? '0';
      setResult({ txId, lpMinted: estimatedLp });

      // Notify backend to update its in-memory state
      try {
        await addLiquidityToPool({
          poolId: selectedPoolId,
          amountA,
          amountB: effectiveB,
          providerAddress: wallet.address,
        });
      } catch {
        // Non-critical — on-chain tx already succeeded
      }
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setAdding(false);
    }
  }

  const activePools = pools.filter(p => p.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      {/* Wallet status banner */}
      {!wallet.address && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-3">
          <Wallet size={20} className="text-yellow-400 flex-shrink-0" />
          <div>
            <div className="font-semibold text-sm text-yellow-400">Wallet Not Connected</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Connect your wallet to add liquidity. LP tokens will be minted directly to your wallet.
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => wallet.openLoginModal()} className="ml-auto">
            Connect Wallet
          </Button>
        </div>
      )}

      {wallet.address && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center gap-3">
          <Wallet size={16} className="text-primary flex-shrink-0" />
          <div className="text-sm">
            <span className="text-muted-foreground">Connected: </span>
            <span className="font-mono text-xs">{wallet.address}</span>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">LP tokens will be sent to this wallet</div>
        </div>
      )}

      {/* Pool selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Pool</CardTitle>
        </CardHeader>
        <div className="flex gap-2 flex-wrap">
          {activePools.map(p => (
            <button
              key={p.poolId}
              onClick={() => { setSelectedPoolId(p.poolId); setResult(null); setError(null); setAmountA(''); setAmountB(''); }}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm font-medium transition-all',
                selectedPoolId === p.poolId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50 text-muted-foreground',
              )}
            >
              <div>{p.tokenASymbol} / {p.tokenBSymbol}</div>
              <div className="text-xs text-muted-foreground">{formatUsd(p.tvlUsd)} TVL</div>
            </button>
          ))}
          {activePools.length === 0 && (
            <p className="text-sm text-muted-foreground">No active pools available.</p>
          )}
        </div>
      </Card>

      {selectedPool && (
        <>
          {/* Current pool state */}
          <Card>
            <CardHeader>
              <CardTitle>Current Reserves</CardTitle>
            </CardHeader>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">{selectedPool.tokenASymbol}</span>
                <div className="font-medium">{formatNumber(parseFloat(selectedPool.reserveA) / 1e8, 4)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{selectedPool.tokenBSymbol}</span>
                <div className="font-medium">{formatNumber(parseFloat(selectedPool.reserveB) / 1e8, 4)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">LP Supply</span>
                <div className="font-medium">{formatNumber(parseFloat(selectedPool.totalLpSupply) / 1e8, 4)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Price</span>
                <div className="font-medium">
                  1 {selectedPool.tokenBSymbol} = {(parseFloat(selectedPool.reserveA) / parseFloat(selectedPool.reserveB)).toFixed(4)} {selectedPool.tokenASymbol}
                </div>
              </div>
            </div>
          </Card>

          {/* Add liquidity form */}
          <Card>
            <CardHeader>
              <CardTitle>Add Liquidity</CardTitle>
              <p className="text-xs text-muted-foreground">
                Provide both tokens proportionally. LP tokens will be minted directly to your connected wallet.
              </p>
            </CardHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Amount {selectedPool.tokenASymbol}</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amountA}
                    onChange={e => { setAmountA(e.target.value); setAmountB(''); }}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Amount {selectedPool.tokenBSymbol} (auto-calculated)</span>
                  <Input
                    type="number"
                    placeholder={autoAmountB || '0.00'}
                    value={amountB || autoAmountB}
                    onChange={e => setAmountB(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    Proportional to current reserves
                  </span>
                </label>
              </div>

              {/* LP token preview */}
              {lpPreview && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-green-400">LP TOKENS TO BE MINTED</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">LP Tokens</span>
                      <div className="font-bold text-lg text-green-400">{formatNumber(parseFloat(lpPreview) / 1e8, 4)}</div>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Pool Share</span>
                      <div className="font-medium">{sharePreview}%</div>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Recipient</span>
                      <div className="font-mono text-xs">{wallet.address || '(connect wallet)'}</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    LP tokens are real on-chain assets. They will appear in your wallet and entitle you to a pro-rata share of pool reserves and accumulated swap fees.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                  <AlertTriangle size={20} className="text-red-400 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-sm text-red-400">Transaction Failed</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{error}</div>
                  </div>
                </div>
              )}

              {/* Success result */}
              {result && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle2 size={20} className="text-green-400 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-sm text-green-400">Liquidity Added On-Chain</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ~{formatNumber(parseFloat(result.lpMinted) / 1e8, 4)} LP tokens minted to your wallet
                    </div>
                    <div className="text-xs font-mono text-muted-foreground mt-1">
                      Tx: {result.txId}
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={handleAdd}
                disabled={!amountA || parseFloat(amountA) <= 0 || !wallet.address || adding}
                size="lg"
              >
                {!wallet.address ? (
                  <>
                    <Wallet size={16} />
                    Connect Wallet to Add Liquidity
                  </>
                ) : (
                  <>
                    <Droplets size={16} />
                    {adding ? 'Signing Transaction...' : 'Sign & Add Liquidity'}
                  </>
                )}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
