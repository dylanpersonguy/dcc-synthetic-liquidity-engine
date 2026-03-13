import { useState, useCallback } from 'react';
import { cn, formatUsd, formatNumber, formatPercent } from '@/lib/utils';
import { Card, CardTitle, Button, Skeleton, Separator } from '@/components/ui/primitives';
import { useSyntheticAssets, useVaultState, useSyntheticHistory } from '@/hooks/use-queries';
import { useWallet } from '@/stores/wallet';
import { mintSynthetic, burnSynthetic } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';
import type { SyntheticAssetInfo } from '@/types';
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Shield,
  Flame,
  ArrowDown,
  ArrowUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Wallet,
} from 'lucide-react';

// ── Vault Overview Card ────────────────────────────────────────────────

function VaultOverview() {
  const { data: vault, isLoading } = useVaultState();

  if (isLoading || !vault) {
    return <Skeleton className="h-36" />;
  }

  const ratioColor = vault.backingRatio >= 1.1
    ? 'text-health-healthy'
    : vault.backingRatio >= 1.0
      ? 'text-health-degraded'
      : 'text-health-down';

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield size={16} className="text-primary" />
          Synthetic Vault
        </CardTitle>
        <span className={cn('text-sm font-bold', ratioColor)}>
          {(vault.backingRatio * 100).toFixed(1)}% Backed
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Total Backing</div>
          <div className="text-lg font-bold">{formatUsd(vault.totalBackingUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total Liability</div>
          <div className="text-lg font-bold">{formatUsd(vault.totalLiabilityUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Net Surplus</div>
          <div className="text-lg font-bold text-health-healthy">
            {formatUsd(vault.totalBackingUsd - vault.totalLiabilityUsd)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Synthetic Asset Card ───────────────────────────────────────────────

function AssetCard({
  asset,
  selected,
  onClick,
}: {
  asset: SyntheticAssetInfo;
  selected: boolean;
  onClick: () => void;
}) {
  const utilization = asset.totalSupply / asset.supplyCap;
  const utilizationPct = (utilization * 100).toFixed(1);

  return (
    <Card
      className={cn(
        'p-4 cursor-pointer transition-all hover:border-primary/50',
        selected && 'border-primary ring-1 ring-primary/30',
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Coins size={16} className="text-primary" />
          </div>
          <div>
            <div className="font-bold text-sm">{asset.symbol}</div>
            <div className="text-xs text-muted-foreground">{asset.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold font-mono">{formatUsd(asset.markPrice)}</div>
          <div className={cn(
            'text-xs font-medium flex items-center gap-0.5 justify-end',
            asset.change24h >= 0 ? 'text-health-healthy' : 'text-health-down',
          )}>
            {asset.change24h >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {formatPercent(asset.change24h)}
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Supply</div>
          <div className="text-xs font-mono font-medium">{formatNumber(asset.totalSupply, 2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Cap</div>
          <div className="text-xs font-mono font-medium">{formatNumber(asset.supplyCap, 0)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Backing</div>
          <div className={cn(
            'text-xs font-mono font-medium',
            asset.backingRatio >= 1.1 ? 'text-health-healthy' : 'text-health-degraded',
          )}>
            {(asset.backingRatio * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>Utilization</span>
          <span>{utilizationPct}%</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              utilization > 0.95 ? 'bg-health-down' :
              utilization > 0.8 ? 'bg-health-degraded' : 'bg-primary',
            )}
            style={{ width: `${Math.min(100, utilization * 100)}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

// ── Mint / Burn Panel ──────────────────────────────────────────────────

function MintBurnPanel({ asset }: { asset: SyntheticAssetInfo }) {
  const { address, openLoginModal } = useWallet();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'mint' | 'burn'>('mint');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount) || 0;

  const estimatedOutput = mode === 'mint'
    ? parsedAmount > 0 && asset.markPrice > 0 ? (parsedAmount * (1 - asset.mintFee)) / asset.markPrice : 0
    : parsedAmount > 0 ? parsedAmount * asset.markPrice * (1 - asset.burnFee) : 0;

  const estimatedFee = mode === 'mint'
    ? parsedAmount * asset.mintFee
    : parsedAmount * asset.markPrice * asset.burnFee;

  const remainingCap = asset.supplyCap - asset.totalSupply;
  const mintOverCap = mode === 'mint' && estimatedOutput > remainingCap;
  const priceUnavailable = asset.markPrice <= 0;

  const handleSubmit = useCallback(async () => {
    if (!address || parsedAmount <= 0) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (mode === 'mint') {
        const res = await mintSynthetic({
          syntheticAssetId: asset.syntheticAssetId,
          collateralAmount: parsedAmount,
          collateralAsset: 'DUSD',
          userAddress: address,
        });
        setResult(`Minted ${formatNumber(res.mintedAmount, 6)} ${asset.symbol}`);
      } else {
        const res = await burnSynthetic({
          syntheticAssetId: asset.syntheticAssetId,
          burnAmount: parsedAmount,
          userAddress: address,
        });
        setResult(`Burned ${formatNumber(res.burnedAmount, 6)} ${asset.symbol} → ${formatUsd(res.collateralReturned)} DUSD`);
      }
      setAmount('');
      queryClient.invalidateQueries({ queryKey: ['synthetic-assets'] });
      queryClient.invalidateQueries({ queryKey: ['vault-state'] });
      queryClient.invalidateQueries({ queryKey: ['synthetic-history'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setLoading(false);
    }
  }, [address, parsedAmount, mode, asset, queryClient]);

  return (
    <Card className="p-5">
      <CardTitle className="text-base mb-4 flex items-center gap-2">
        {mode === 'mint' ? <ArrowUp size={16} className="text-health-healthy" /> : <ArrowDown size={16} className="text-health-down" />}
        {mode === 'mint' ? 'Mint' : 'Burn'} {asset.symbol}
      </CardTitle>

      {/* Mode Toggle */}
      <div className="flex rounded-lg bg-secondary p-0.5 mb-4">
        <button
          className={cn(
            'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
            mode === 'mint' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
          )}
          onClick={() => { setMode('mint'); setAmount(''); setResult(null); setError(null); }}
        >
          Mint
        </button>
        <button
          className={cn(
            'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
            mode === 'burn' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
          )}
          onClick={() => { setMode('burn'); setAmount(''); setResult(null); setError(null); }}
        >
          Burn
        </button>
      </div>

      {/* Input */}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {mode === 'mint' ? 'Collateral (DUSD)' : `${asset.symbol} Amount`}
          </label>
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setResult(null); setError(null); }}
            className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Estimate */}
        {parsedAmount > 0 && (
          <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {mode === 'mint' ? `You receive` : 'You receive (DUSD)'}
              </span>
              <span className="font-mono font-medium">
                {mode === 'mint'
                  ? `${formatNumber(estimatedOutput, 6)} ${asset.symbol}`
                  : formatUsd(estimatedOutput)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Fee ({(mode === 'mint' ? asset.mintFee : asset.burnFee) * 100}%)</span>
              <span className="font-mono text-muted-foreground">{formatUsd(estimatedFee)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Mark Price</span>
              <span className="font-mono">{formatUsd(asset.markPrice)}</span>
            </div>
            {mode === 'mint' && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Remaining Cap</span>
                <span className={cn('font-mono', mintOverCap ? 'text-health-down' : '')}>
                  {formatNumber(remainingCap, 2)} {asset.symbol}
                </span>
              </div>
            )}
          </div>
        )}

        {mintOverCap && (
          <div className="flex items-center gap-1.5 text-xs text-health-down">
            <AlertTriangle size={12} />
            Exceeds supply cap. Max mintable: {formatNumber(remainingCap, 2)} {asset.symbol}
          </div>
        )}

        {priceUnavailable && (
          <div className="flex items-center gap-1.5 text-xs text-health-down">
            <AlertTriangle size={12} />
            Price feed unavailable. Minting/burning disabled until oracle provides a price.
          </div>
        )}

        {/* Action Button */}
        {!address ? (
          <Button variant="primary" className="w-full" onClick={openLoginModal}>
            <Wallet size={14} className="mr-1.5" />
            Connect Wallet
          </Button>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={loading || parsedAmount <= 0 || mintOverCap || priceUnavailable}
            onClick={handleSubmit}
          >
            {loading ? (
              <><Flame size={14} className="mr-1.5 animate-spin" /> Processing...</>
            ) : mode === 'mint' ? (
              <><ArrowUp size={14} className="mr-1.5" /> Mint {asset.symbol}</>
            ) : (
              <><ArrowDown size={14} className="mr-1.5" /> Burn {asset.symbol}</>
            )}
          </Button>
        )}

        {/* Result / Error */}
        {result && (
          <div className="flex items-center gap-1.5 text-xs text-health-healthy bg-health-healthy/10 px-3 py-2 rounded-lg">
            <CheckCircle2 size={12} />
            {result}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-health-down bg-health-down/10 px-3 py-2 rounded-lg">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── History Table ──────────────────────────────────────────────────────

function HistoryTable() {
  const { address } = useWallet();
  const { data, isLoading } = useSyntheticHistory(address ?? undefined);

  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;

  const entries = [
    ...data.mints.map((m) => ({
      id: m.mintId,
      type: 'mint' as const,
      symbol: m.symbol,
      amount: m.mintedAmount,
      value: m.collateralAmount,
      fee: m.feeAmount,
      createdAt: m.createdAt,
      status: m.status,
    })),
    ...data.burns.map((b) => ({
      id: b.burnId,
      type: 'burn' as const,
      symbol: b.symbol,
      amount: b.burnedAmount,
      value: b.collateralReturned,
      fee: b.feeAmount,
      createdAt: b.createdAt,
      status: b.status,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  if (entries.length === 0) {
    return (
      <Card className="p-5 text-center text-sm text-muted-foreground">
        No mint or burn activity yet.
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <CardTitle className="text-base mb-3 flex items-center gap-2">
        <Clock size={16} className="text-muted-foreground" />
        Recent Activity
      </CardTitle>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <div className="flex items-center gap-2">
              {entry.type === 'mint' ? (
                <div className="w-6 h-6 rounded-full bg-health-healthy/10 flex items-center justify-center">
                  <ArrowUp size={12} className="text-health-healthy" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-health-down/10 flex items-center justify-center">
                  <ArrowDown size={12} className="text-health-down" />
                </div>
              )}
              <div>
                <div className="text-sm font-medium">
                  {entry.type === 'mint' ? 'Mint' : 'Burn'} {formatNumber(entry.amount, 4)} {entry.symbol}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{entry.id}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono">{formatUsd(entry.value)}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export function SyntheticsPage() {
  const { data: assets, isLoading } = useSyntheticAssets();
  const [selectedId, setSelectedId] = useState<string>('sSOL');

  const selected = assets?.find((a) => a.syntheticAssetId === selectedId) ?? assets?.[0] ?? null;

  if (isLoading) {
    return (
      <div className="py-8 space-y-4">
        <Skeleton className="h-36" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
    );
  }

  return (
    <div className="py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Synthetic Assets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mint and burn synthetic representations of external assets on DecentralChain.
          Backed by DUSD collateral in the protocol vault.
        </p>
      </div>

      {/* Vault Overview */}
      <VaultOverview />

      {/* Asset Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {assets?.map((asset) => (
          <AssetCard
            key={asset.syntheticAssetId}
            asset={asset}
            selected={selectedId === asset.syntheticAssetId}
            onClick={() => setSelectedId(asset.syntheticAssetId)}
          />
        ))}
      </div>

      {/* Mint/Burn + History */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MintBurnPanel asset={selected} />
          <HistoryTable />
        </div>
      )}
    </div>
  );
}
