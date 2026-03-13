import { useState, useMemo } from 'react';
import { useAdminSynthetics, useOracleProviders } from '@/hooks/use-queries';
import {
  createAdminSynthetic,
  updateAdminSynthetic,
  setSyntheticStatus,
  addOracleToSynthetic,
  removeOracleFromSynthetic,
} from '@/api/client';
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
  AdminSyntheticAsset,
  SyntheticBackingModel,
  SyntheticAssetStatus,
  OracleProvider,
  CreateSyntheticRequest,
} from '@/types';
import {
  Plus,
  Settings,
  Database,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Pause,
  XCircle,
  Radio,
  Search,
} from 'lucide-react';

// ── Main Page ──────────────────────────────────────────────────────────

export function AdminSyntheticsPage() {
  const [tab, setTab] = useState<'overview' | 'create' | 'oracles'>('overview');
  const { data: synthetics, isLoading, refetch } = useAdminSynthetics();
  const { data: providers } = useOracleProviders();

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
        <h1 className="text-2xl font-bold tracking-tight">Synthetic Markets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create and configure synthetic assets, manage oracle feeds, and control market parameters.
        </p>
      </div>

      <TabList>
        <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>All Markets</Tab>
        <Tab active={tab === 'create'} onClick={() => setTab('create')}>Create New</Tab>
        <Tab active={tab === 'oracles'} onClick={() => setTab('oracles')}>Oracle Feeds</Tab>
      </TabList>

      {tab === 'overview' && (
        <SyntheticsOverview
          synthetics={synthetics ?? []}
          onRefetch={refetch}
        />
      )}
      {tab === 'create' && (
        <CreateSyntheticPanel
          providers={providers ?? []}
          onCreated={() => { refetch(); setTab('overview'); }}
        />
      )}
      {tab === 'oracles' && (
        <OracleManagementPanel
          synthetics={synthetics ?? []}
          providers={providers ?? []}
          onRefetch={refetch}
        />
      )}
    </div>
  );
}

// ── Status helpers ─────────────────────────────────────────────────────

const STATUS_META: Record<SyntheticAssetStatus, { label: string; color: string; icon: React.ReactNode }> = {
  ACTIVE: { label: 'Active', color: 'text-green-400 bg-green-400/10', icon: <CheckCircle2 size={12} /> },
  PAUSED: { label: 'Paused', color: 'text-amber-400 bg-amber-400/10', icon: <Pause size={12} /> },
  WIND_DOWN: { label: 'Wind Down', color: 'text-orange-400 bg-orange-400/10', icon: <AlertTriangle size={12} /> },
  DISABLED: { label: 'Disabled', color: 'text-red-400 bg-red-400/10', icon: <XCircle size={12} /> },
};

function StatusBadge({ status }: { status: SyntheticAssetStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', meta.color)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function ModelBadge({ model }: { model: SyntheticBackingModel }) {
  const isInv = model === 'INVENTORY_BACKED';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      isInv ? 'text-blue-400 bg-blue-400/10' : 'text-purple-400 bg-purple-400/10',
    )}>
      <Database size={10} />
      {isInv ? 'Inventory' : 'Overcollat.'}
    </span>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────

function SyntheticsOverview({ synthetics, onRefetch }: {
  synthetics: AdminSyntheticAsset[];
  onRefetch: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const inventoryBacked = synthetics.filter(s => s.backingModel === 'INVENTORY_BACKED');
  const overcollateralized = synthetics.filter(s => s.backingModel === 'OVERCOLLATERALIZED');

  async function handleStatusChange(synthId: string, status: SyntheticAssetStatus) {
    await setSyntheticStatus(synthId, status);
    onRefetch();
  }

  return (
    <div className="space-y-8">
      {/* Inventory-backed section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-blue-400" />
          <h2 className="text-lg font-semibold">Inventory-Backed</h2>
          <span className="text-xs text-muted-foreground">
            Protocol reserves back the supply. Simpler but requires capital.
          </span>
        </div>
        {inventoryBacked.length === 0 && (
          <Card><p className="text-sm text-muted-foreground">No inventory-backed synthetics yet.</p></Card>
        )}
        {inventoryBacked.map(s => (
          <SyntheticRow
            key={s.syntheticAssetId}
            asset={s}
            expanded={expanded === s.syntheticAssetId}
            editing={editingId === s.syntheticAssetId}
            onToggle={() => setExpanded(expanded === s.syntheticAssetId ? null : s.syntheticAssetId)}
            onEdit={() => setEditingId(editingId === s.syntheticAssetId ? null : s.syntheticAssetId)}
            onStatusChange={handleStatusChange}
            onRefetch={onRefetch}
          />
        ))}
      </div>

      <Separator />

      {/* Overcollateralized section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-purple-400" />
          <h2 className="text-lg font-semibold">Overcollateralized</h2>
          <span className="text-xs text-muted-foreground">
            Users lock collateral &gt;100% to mint. More decentralized, requires liquidation.
          </span>
        </div>
        {overcollateralized.length === 0 && (
          <Card><p className="text-sm text-muted-foreground">No overcollateralized synthetics yet.</p></Card>
        )}
        {overcollateralized.map(s => (
          <SyntheticRow
            key={s.syntheticAssetId}
            asset={s}
            expanded={expanded === s.syntheticAssetId}
            editing={editingId === s.syntheticAssetId}
            onToggle={() => setExpanded(expanded === s.syntheticAssetId ? null : s.syntheticAssetId)}
            onEdit={() => setEditingId(editingId === s.syntheticAssetId ? null : s.syntheticAssetId)}
            onStatusChange={handleStatusChange}
            onRefetch={onRefetch}
          />
        ))}
      </div>
    </div>
  );
}

// ── Synthetic Row ──────────────────────────────────────────────────────

function SyntheticRow({ asset, expanded, editing, onToggle, onEdit, onStatusChange, onRefetch }: {
  asset: AdminSyntheticAsset;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStatusChange: (id: string, status: SyntheticAssetStatus) => void;
  onRefetch: () => void;
}) {
  const [editForm, setEditForm] = useState({
    supplyCap: asset.supplyCap,
    targetBackingRatio: asset.targetBackingRatio,
    isRedeemable: asset.isRedeemable,
    mintFee: asset.mintFee,
    burnFee: asset.burnFee,
  });
  const [saving, setSaving] = useState(false);

  const utilization = asset.supplyCap > 0 ? (asset.totalSupply / asset.supplyCap) * 100 : 0;

  async function handleSave() {
    setSaving(true);
    await updateAdminSynthetic(asset.syntheticAssetId, editForm);
    setSaving(false);
    onEdit();
    onRefetch();
  }

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Collapsed header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
            {asset.underlyingSymbol.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{asset.symbol}</span>
              <span className="text-xs text-muted-foreground">{asset.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <ModelBadge model={asset.backingModel} />
              <StatusBadge status={asset.status} />
              <span className="text-xs text-muted-foreground">
                {asset.oracleSources.length} oracle{asset.oracleSources.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-sm font-medium">{formatUsd(asset.markPrice)}</div>
            <div className={cn('text-xs', asset.change24h >= 0 ? 'text-green-400' : 'text-red-400')}>
              {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(1)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Supply</div>
            <div className="text-sm font-medium">{formatNumber(asset.totalSupply, 2)} / {formatNumber(asset.supplyCap, 0)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Util.</div>
            <div className="text-sm font-medium">{utilization.toFixed(1)}%</div>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-accent/5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Underlying</span>
              <div className="font-medium">{asset.underlyingSymbol} ({asset.underlyingAssetId})</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Backing Asset</span>
              <div className="font-medium">{asset.backingAssetId}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Target Backing Ratio</span>
              <div className="font-medium">{(asset.targetBackingRatio * 100).toFixed(0)}%</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Decimals</span>
              <div className="font-medium">{asset.decimals}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Mint Fee</span>
              <div className="font-medium">{(asset.mintFee * 100).toFixed(1)}%</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Burn Fee</span>
              <div className="font-medium">{(asset.burnFee * 100).toFixed(1)}%</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Risk Tier</span>
              <div className="font-medium">{asset.riskTier}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Redeemable</span>
              <div className="font-medium">{asset.isRedeemable ? 'Yes' : 'No'}</div>
            </div>
          </div>

          {/* Oracle Sources */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">ORACLE SOURCES</h4>
            <div className="space-y-1.5">
              {asset.oracleSources.map(o => (
                <div key={o.sourceId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background text-sm">
                  <div className="flex items-center gap-2">
                    <Radio size={12} className="text-green-400" />
                    <span className="font-medium">{o.providerName}</span>
                    <span className="text-xs text-muted-foreground">{o.coinId}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Weight: {(o.weight * 100).toFixed(0)}%</span>
                    <span>Staleness: {(o.maxStalenessMs / 1000).toFixed(0)}s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Utilization bar */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Supply Cap Utilization</span>
              <span>{utilization.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', utilization > 80 ? 'bg-red-500' : utilization > 50 ? 'bg-amber-500' : 'bg-green-500')}
                style={{ width: `${Math.min(utilization, 100)}%` }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Settings size={12} /> {editing ? 'Cancel Edit' : 'Edit Config'}
            </Button>
            {asset.status === 'ACTIVE' && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(asset.syntheticAssetId, 'PAUSED')}>
                <Pause size={12} /> Pause
              </Button>
            )}
            {asset.status === 'PAUSED' && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(asset.syntheticAssetId, 'ACTIVE')}>
                <CheckCircle2 size={12} /> Resume
              </Button>
            )}
            {(asset.status === 'ACTIVE' || asset.status === 'PAUSED') && (
              <Button variant="ghost" size="sm" onClick={() => onStatusChange(asset.syntheticAssetId, 'WIND_DOWN')}>
                <AlertTriangle size={12} /> Wind Down
              </Button>
            )}
          </div>

          {/* Edit form */}
          {editing && (
            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="text-sm font-semibold">Edit Configuration</h4>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Supply Cap</span>
                  <Input
                    type="number"
                    value={editForm.supplyCap}
                    onChange={e => setEditForm({ ...editForm, supplyCap: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Target Backing Ratio</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.targetBackingRatio}
                    onChange={e => setEditForm({ ...editForm, targetBackingRatio: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Mint Fee</span>
                  <Input
                    type="number"
                    step="0.001"
                    value={editForm.mintFee}
                    onChange={e => setEditForm({ ...editForm, mintFee: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Burn Fee</span>
                  <Input
                    type="number"
                    step="0.001"
                    value={editForm.burnFee}
                    onChange={e => setEditForm({ ...editForm, burnFee: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    checked={editForm.isRedeemable}
                    onChange={e => setEditForm({ ...editForm, isRedeemable: e.target.checked })}
                    className="rounded border-border"
                  />
                  <span className="text-sm">Redeemable</span>
                </label>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="ghost" size="sm" onClick={onEdit}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Create Synthetic Tab ───────────────────────────────────────────────

function CreateSyntheticPanel({ providers, onCreated }: {
  providers: OracleProvider[];
  onCreated: () => void;
}) {
  const [model, setModel] = useState<SyntheticBackingModel>('INVENTORY_BACKED');
  const [form, setForm] = useState<CreateSyntheticRequest>({
    symbol: '',
    name: '',
    underlyingSymbol: '',
    underlyingAssetId: '',
    decimals: 8,
    backingModel: 'INVENTORY_BACKED',
    backingAssetId: 'DUSD',
    targetBackingRatio: 1.15,
    supplyCap: 1000,
    isRedeemable: true,
    riskTier: 'tier_2',
    mintFee: 0.002,
    burnFee: 0.001,
    oracleSources: [],
  });
  const [selectedOracles, setSelectedOracles] = useState<CreateSyntheticRequest['oracleSources']>([]);
  const [coinSearch, setCoinSearch] = useState('');
  const [creating, setCreating] = useState(false);

  function handleModelSwitch(m: SyntheticBackingModel) {
    setModel(m);
    setForm(f => ({
      ...f,
      backingModel: m,
      targetBackingRatio: m === 'OVERCOLLATERALIZED' ? 1.50 : 1.15,
    }));
  }

  function handleCoinSelect(coin: { coinId: string; symbol: string; name: string }) {
    setForm(f => ({
      ...f,
      symbol: `s${coin.symbol}`,
      name: `Synthetic ${coin.name}`,
      underlyingSymbol: coin.symbol,
      underlyingAssetId: coin.coinId,
    }));
  }

  function addOracle(providerId: string, providerName: string, coinId: string) {
    if (selectedOracles.some(o => o.providerId === providerId)) return;
    const totalWeight = selectedOracles.reduce((s, o) => s + o.weight, 0);
    const remaining = Math.max(0, 1 - totalWeight);
    const weight = selectedOracles.length === 0 ? 0.5 : Math.min(remaining, 0.25);
    setSelectedOracles([...selectedOracles, {
      providerId,
      providerName,
      coinId,
      weight: parseFloat(weight.toFixed(2)),
      maxStalenessMs: 60_000,
    }]);
  }

  function removeOracle(providerId: string) {
    setSelectedOracles(selectedOracles.filter(o => o.providerId !== providerId));
  }

  function updateOracleWeight(providerId: string, weight: number) {
    setSelectedOracles(selectedOracles.map(o => o.providerId === providerId ? { ...o, weight } : o));
  }

  function updateOracleStaleness(providerId: string, maxStalenessMs: number) {
    setSelectedOracles(selectedOracles.map(o => o.providerId === providerId ? { ...o, maxStalenessMs } : o));
  }

  const totalWeight = selectedOracles.reduce((s, o) => s + o.weight, 0);
  const isValid = form.symbol && form.name && form.underlyingSymbol && selectedOracles.length > 0 && Math.abs(totalWeight - 1) < 0.01;

  async function handleCreate() {
    setCreating(true);
    try {
      await createAdminSynthetic({ ...form, oracleSources: selectedOracles });
      onCreated();
    } catch (err) {
      console.error('Failed to create synthetic:', err);
      alert(`Failed to create synthetic: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCreating(false);
    }
  }

  const searchLower = coinSearch.toLowerCase();
  const matchedCoins = useMemo(() => {
    if (!coinSearch) return [];
    const seen = new Set<string>();
    const result: { coinId: string; symbol: string; name: string }[] = [];
    for (const p of providers) {
      for (const c of p.coins) {
        if (seen.has(c.symbol)) continue;
        if (c.symbol.toLowerCase().includes(searchLower) || c.name.toLowerCase().includes(searchLower)) {
          seen.add(c.symbol);
          result.push(c);
        }
      }
    }
    return result.slice(0, 12);
  }, [providers, coinSearch, searchLower]);

  return (
    <div className="space-y-6">
      {/* Model selection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Choose Backing Model</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <button
            onClick={() => handleModelSwitch('INVENTORY_BACKED')}
            className={cn(
              'p-4 rounded-xl border-2 text-left transition-all',
              model === 'INVENTORY_BACKED'
                ? 'border-blue-500 bg-blue-500/5'
                : 'border-border hover:border-blue-500/50',
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Database size={16} className="text-blue-400" />
              <span className="font-semibold text-sm">Inventory-Backed</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Protocol reserves (DUSD) back the synthetic supply. You control the pool.
              Best for low-liquidity bootstrap — start with small caps and grow.
              Target backing ratio is a soft guideline (≥100% recommended).
            </p>
          </button>
          <button
            onClick={() => handleModelSwitch('OVERCOLLATERALIZED')}
            className={cn(
              'p-4 rounded-xl border-2 text-left transition-all',
              model === 'OVERCOLLATERALIZED'
                ? 'border-purple-500 bg-purple-500/5'
                : 'border-border hover:border-purple-500/50',
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Database size={16} className="text-purple-400" />
              <span className="font-semibold text-sm">Overcollateralized</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Users lock collateral &gt;150% of the synthetic's value to mint.
              Liquidates under-collateralized positions. More decentralized.
              Requires 120% liquidation threshold and active liquidation bots.
            </p>
          </button>
        </div>
      </Card>

      {/* Asset selection */}
      <Card>
        <CardHeader>
          <CardTitle>2. Select Underlying Asset</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search for a coin... (e.g. BTC, SOL, AVAX)"
              value={coinSearch}
              onChange={e => setCoinSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {matchedCoins.length > 0 && (
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
              {matchedCoins.map(c => (
                <button
                  key={c.symbol}
                  onClick={() => { handleCoinSelect(c); setCoinSearch(''); }}
                  className={cn(
                    'p-2 rounded-lg border text-center transition-all',
                    form.underlyingSymbol === c.symbol
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  <div className="font-semibold text-sm">{c.symbol}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.name}</div>
                </button>
              ))}
            </div>
          )}

          {/* Manual fields */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Symbol</span>
              <Input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} placeholder="sSOL" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Synthetic SOL" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Underlying Symbol</span>
              <Input value={form.underlyingSymbol} onChange={e => setForm({ ...form, underlyingSymbol: e.target.value })} placeholder="SOL" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Decimals</span>
              <Input type="number" value={form.decimals} onChange={e => setForm({ ...form, decimals: Number(e.target.value) })} />
            </label>
          </div>
        </div>
      </Card>

      {/* Parameters */}
      <Card>
        <CardHeader>
          <CardTitle>3. Configure Parameters</CardTitle>
          <ModelBadge model={model} />
        </CardHeader>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Backing Asset</span>
            <select
              value={form.backingAssetId}
              onChange={e => setForm({ ...form, backingAssetId: e.target.value })}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="DUSD">DUSD</option>
              <option value="DCC">DCC</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              {model === 'OVERCOLLATERALIZED' ? 'Min Collateral Ratio' : 'Target Backing Ratio'}
            </span>
            <Input
              type="number"
              step="0.05"
              value={form.targetBackingRatio}
              onChange={e => setForm({ ...form, targetBackingRatio: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">
              {model === 'OVERCOLLATERALIZED' ? '≥ 1.5 recommended' : '≥ 1.0 (100%) recommended'}
            </span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Supply Cap</span>
            <Input
              type="number"
              value={form.supplyCap}
              onChange={e => setForm({ ...form, supplyCap: Number(e.target.value) })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Mint Fee</span>
            <Input
              type="number"
              step="0.001"
              value={form.mintFee}
              onChange={e => setForm({ ...form, mintFee: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">{(form.mintFee * 100).toFixed(1)}%</span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Burn Fee</span>
            <Input
              type="number"
              step="0.001"
              value={form.burnFee}
              onChange={e => setForm({ ...form, burnFee: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">{(form.burnFee * 100).toFixed(1)}%</span>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Risk Tier</span>
            <select
              value={form.riskTier}
              onChange={e => setForm({ ...form, riskTier: e.target.value })}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="tier_1">Tier 1 (Lowest Risk)</option>
              <option value="tier_2">Tier 2</option>
              <option value="tier_3">Tier 3</option>
              <option value="tier_4">Tier 4 (Highest Risk)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              checked={form.isRedeemable}
              onChange={e => setForm({ ...form, isRedeemable: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm">Redeemable (users can burn to reclaim collateral)</span>
          </label>
        </div>
      </Card>

      {/* Oracle Sources */}
      <Card>
        <CardHeader>
          <CardTitle>4. Add Oracle Price Feeds</CardTitle>
          <span className={cn('text-xs font-medium', Math.abs(totalWeight - 1) < 0.01 ? 'text-green-400' : 'text-amber-400')}>
            Total weight: {(totalWeight * 100).toFixed(0)}% {Math.abs(totalWeight - 1) < 0.01 ? '✓' : '(must = 100%)'}
          </span>
        </CardHeader>
        <div className="space-y-3">
          {/* Selected oracles */}
          {selectedOracles.length > 0 && (
            <div className="space-y-2">
              {selectedOracles.map(o => (
                <div key={o.providerId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-accent/50 text-sm">
                  <Radio size={12} className="text-green-400 flex-shrink-0" />
                  <span className="font-medium w-32 truncate">{o.providerName}</span>
                  <span className="text-xs text-muted-foreground w-28 truncate">{o.coinId}</span>
                  <label className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Weight:</span>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={o.weight}
                      onChange={e => updateOracleWeight(o.providerId, Number(e.target.value))}
                      className="!h-7 !w-20 !text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Stale after:</span>
                    <Input
                      type="number"
                      step="10000"
                      min="5000"
                      value={o.maxStalenessMs}
                      onChange={e => updateOracleStaleness(o.providerId, Number(e.target.value))}
                      className="!h-7 !w-24 !text-xs"
                    />
                    <span className="text-xs text-muted-foreground">ms</span>
                  </label>
                  <button onClick={() => removeOracle(o.providerId)} className="ml-auto text-red-400 hover:text-red-300">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Available providers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {providers.map(p => {
              const already = selectedOracles.some(o => o.providerId === p.providerId);
              const coin = form.underlyingSymbol
                ? p.coins.find(c => c.symbol === form.underlyingSymbol)
                : undefined;
              return (
                <button
                  key={p.providerId}
                  disabled={already || !coin}
                  onClick={() => coin && addOracle(p.providerId, p.providerName, coin.coinId)}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                    already ? 'border-green-500/50 bg-green-500/5 opacity-60' : !coin ? 'opacity-40 cursor-not-allowed border-border' : 'border-border hover:border-primary/50',
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{p.providerName}</span>
                      {p.requiresApiKey && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400">KEY</span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{p.apiType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Rate limit: {p.freeRateLimit}</p>
                    {coin && <p className="text-xs text-primary mt-0.5">Coin ID: {coin.coinId}</p>}
                  </div>
                  {!already && coin && <Plus size={16} className="text-primary flex-shrink-0 mt-1" />}
                  {already && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0 mt-1" />}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button onClick={handleCreate} disabled={!isValid || creating} size="lg">
          <Plus size={16} /> {creating ? 'Creating...' : 'Create Synthetic Market'}
        </Button>
        {!isValid && (
          <span className="text-xs text-muted-foreground">
            {!form.symbol ? 'Enter a symbol' : selectedOracles.length === 0 ? 'Add at least 1 oracle' : 'Oracle weights must sum to 100%'}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Oracle Management Tab ──────────────────────────────────────────────

function OracleManagementPanel({ synthetics, providers, onRefetch }: {
  synthetics: AdminSyntheticAsset[];
  providers: OracleProvider[];
  onRefetch: () => void;
}) {
  const [selectedSynthId, setSelectedSynthId] = useState(synthetics[0]?.syntheticAssetId ?? '');
  const [addingOracle, setAddingOracle] = useState(false);
  const [newOracle, setNewOracle] = useState({ providerId: '', coinId: '', weight: 0.2, maxStalenessMs: 60_000 });

  const selectedSynth = synthetics.find(s => s.syntheticAssetId === selectedSynthId);

  async function handleAddOracle() {
    if (!selectedSynth || !newOracle.providerId) return;
    const provider = providers.find(p => p.providerId === newOracle.providerId);
    await addOracleToSynthetic(selectedSynthId, {
      ...newOracle,
      providerName: provider?.providerName ?? newOracle.providerId,
    });
    setAddingOracle(false);
    setNewOracle({ providerId: '', coinId: '', weight: 0.2, maxStalenessMs: 60_000 });
    onRefetch();
  }

  async function handleRemoveOracle(sourceId: string) {
    await removeOracleFromSynthetic(selectedSynthId, sourceId);
    onRefetch();
  }

  return (
    <div className="space-y-6">
      {/* Synth selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Synthetic Asset</CardTitle>
        </CardHeader>
        <div className="flex gap-2 flex-wrap">
          {synthetics.map(s => (
            <button
              key={s.syntheticAssetId}
              onClick={() => setSelectedSynthId(s.syntheticAssetId)}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                selectedSynthId === s.syntheticAssetId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50 text-muted-foreground',
              )}
            >
              {s.symbol}
            </button>
          ))}
        </div>
      </Card>

      {selectedSynth && (
        <>
          {/* Current oracle sources */}
          <Card>
            <CardHeader>
              <CardTitle>Oracle Sources for {selectedSynth.symbol}</CardTitle>
              <div className="flex items-center gap-2">
                <ModelBadge model={selectedSynth.backingModel} />
                <span className="text-xs text-muted-foreground">
                  {selectedSynth.oracleSources.length} source{selectedSynth.oracleSources.length !== 1 ? 's' : ''}
                </span>
              </div>
            </CardHeader>
            <div className="space-y-2">
              {selectedSynth.oracleSources.map(o => {
                const provider = providers.find(p => p.providerId === o.providerId);
                return (
                  <div key={o.sourceId} className="flex items-center justify-between px-4 py-3 rounded-lg bg-accent/30">
                    <div className="flex items-center gap-3">
                      <Radio size={14} className="text-green-400" />
                      <div>
                        <div className="font-medium text-sm">{o.providerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.coinId} · {provider?.apiType ?? 'rest'} · {provider?.requiresApiKey ? 'API key required' : 'No key needed'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Weight</div>
                        <div className="text-sm font-medium">{(o.weight * 100).toFixed(0)}%</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Staleness</div>
                        <div className="text-sm font-medium">{(o.maxStalenessMs / 1000).toFixed(0)}s</div>
                      </div>
                      <button onClick={() => handleRemoveOracle(o.sourceId)} className="text-red-400 hover:text-red-300 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {selectedSynth.oracleSources.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">No oracle sources configured. Add at least one.</p>
              )}
            </div>

            {/* Weight total bar */}
            {selectedSynth.oracleSources.length > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Total Oracle Weight</span>
                  {(() => {
                    const total = selectedSynth.oracleSources.reduce((s, o) => s + o.weight, 0);
                    return (
                      <span className={Math.abs(total - 1) < 0.01 ? 'text-green-400' : 'text-amber-400'}>
                        {(total * 100).toFixed(0)}%
                      </span>
                    );
                  })()}
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden flex">
                  {selectedSynth.oracleSources.map((o, i) => (
                    <div
                      key={o.sourceId}
                      className={cn('h-full', ['bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500'][i % 5])}
                      style={{ width: `${o.weight * 100}%` }}
                      title={`${o.providerName}: ${(o.weight * 100).toFixed(0)}%`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              {!addingOracle ? (
                <Button variant="secondary" size="sm" onClick={() => setAddingOracle(true)}>
                  <Plus size={12} /> Add Oracle Source
                </Button>
              ) : (
                <div className="border-t border-border pt-3 space-y-3">
                  <h4 className="text-sm font-semibold">Add New Oracle</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Provider</span>
                      <select
                        value={newOracle.providerId}
                        onChange={e => {
                          const pid = e.target.value;
                          const prov = providers.find(p => p.providerId === pid);
                          const coin = prov?.coins.find(c => c.symbol === selectedSynth.underlyingSymbol);
                          setNewOracle({ ...newOracle, providerId: pid, coinId: coin?.coinId ?? '' });
                        }}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select...</option>
                        {providers
                          .filter(p => !selectedSynth.oracleSources.some(o => o.providerId === p.providerId))
                          .map(p => (
                          <option key={p.providerId} value={p.providerId}>{p.providerName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Coin ID</span>
                      <Input value={newOracle.coinId} onChange={e => setNewOracle({ ...newOracle, coinId: e.target.value })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Weight</span>
                      <Input type="number" step="0.05" min="0" max="1" value={newOracle.weight} onChange={e => setNewOracle({ ...newOracle, weight: Number(e.target.value) })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Max Staleness (ms)</span>
                      <Input type="number" step="10000" value={newOracle.maxStalenessMs} onChange={e => setNewOracle({ ...newOracle, maxStalenessMs: Number(e.target.value) })} />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!newOracle.providerId || !newOracle.coinId} onClick={handleAddOracle}>
                      Add Oracle
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAddingOracle(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Available providers reference */}
          <Card>
            <CardHeader>
              <CardTitle>Available Oracle Providers</CardTitle>
              <span className="text-xs text-muted-foreground">{providers.length} free feeds available</span>
            </CardHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {providers.map(p => {
                const coin = p.coins.find(c => c.symbol === selectedSynth.underlyingSymbol);
                const isAttached = selectedSynth.oracleSources.some(o => o.providerId === p.providerId);
                return (
                  <div key={p.providerId} className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    isAttached ? 'border-green-500/30 bg-green-500/5' : 'border-border',
                  )}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.providerName}</span>
                        {isAttached && <CheckCircle2 size={12} className="text-green-400" />}
                        {p.requiresApiKey && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400">KEY</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{p.freeRateLimit} · {p.apiType}</p>
                      {coin && <p className="text-xs text-primary">Supports {selectedSynth.underlyingSymbol}: {coin.coinId}</p>}
                      {!coin && <p className="text-xs text-red-400">Does not support {selectedSynth.underlyingSymbol}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
